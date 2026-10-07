-- ==============================================================================
-- 臺中市政府消防局 鳳凰救護大隊 博館分隊
-- 救護義消智慧協勤與履歷管理系統 - Supabase PostgreSQL Schema
-- ==============================================================================

-- 1. 救護義消成員名冊 (Members)
CREATE TABLE IF NOT EXISTS public.members (
    id TEXT PRIMARY KEY,                     -- 'm1', 'm2' 或 UUID
    name VARCHAR(50) NOT NULL,
    id_no VARCHAR(20),                       -- 身分證字號 (公文檢查用)
    role VARCHAR(50) DEFAULT '救護義消隊員', -- 救護義消隊員、小隊長、幹部、實習生
    level VARCHAR(20) DEFAULT 'EMT-2',       -- EMT-1, EMT-2, EMT-P (TP)
    avatar VARCHAR(20) DEFAULT '👨‍🚒',
    phone VARCHAR(20),
    joined_year_month VARCHAR(20),          -- 例如 '111年3月'
    total_hours NUMERIC(6, 1) DEFAULT 0,
    total_dispatches INT DEFAULT 0,
    rosc_count INT DEFAULT 0,
    ecg_count INT DEFAULT 0,
    iv_count INT DEFAULT 0,
    is_restricted BOOLEAN DEFAULT FALSE,    -- 是否處於累犯填班管制期
    restriction_until VARCHAR(20),          -- 管制到期日 (例如 '115-12-07')
    restriction_count INT DEFAULT 0,        -- 違規處分次數
    makeup_training_status VARCHAR(50) DEFAULT 'eligible', -- 'eligible', 'cancelled_absent'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 協勤排班表 (Shifts)
CREATE TABLE IF NOT EXISTS public.shifts (
    id TEXT PRIMARY KEY,                     -- 例如 's-101' 或 's-1728293849'
    shift_date VARCHAR(20) NOT NULL,         -- '115-10-07'
    day_num INT,                             -- 7
    day_of_week VARCHAR(10),                 -- '三'
    vehicle VARCHAR(30) NOT NULL,            -- '救護協勤', '值班台', '值班台 (補定訓)' (無 91/92 車別限制，隊上待命隨車出勤)
    period VARCHAR(50) NOT NULL,             -- '18:00-23:00', '18:00-22:00'
    member_name VARCHAR(50),                 -- '謝易庭' 或空 (缺協勤)
    shift_type VARCHAR(30) DEFAULT '自排班',  -- '自排班', '固定班', '幹部值班', '補定訓'
    status VARCHAR(20) DEFAULT '已排班',     -- '已排班', '缺協勤', '已完成'
    is_makeup_training BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 簽到簽退紀錄表 (Attendance) - 對應官方公文「簽到簽退紀錄表」
CREATE TABLE IF NOT EXISTS public.attendance (
    id TEXT PRIMARY KEY,
    member_id TEXT REFERENCES public.members(id) ON DELETE SET NULL,
    member_name VARCHAR(50) NOT NULL,
    attendance_date VARCHAR(20) NOT NULL,    -- '115-10-07'
    sign_in_time VARCHAR(10) NOT NULL,       -- '18:00'
    sign_out_time VARCHAR(10),               -- '23:00'
    hours NUMERIC(4, 1) DEFAULT 0,
    dispatches_count INT DEFAULT 0,          -- 當日出勤趟次
    patients_count INT DEFAULT 0,            -- 當日服務人次
    notes TEXT,                              -- 備註 (車號、值班性質等)
    verified_by_officer BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 救護出勤紀錄表 (Dispatch Records) - 對應官方公文「參與緊急救護出勤紀錄表」
CREATE TABLE IF NOT EXISTS public.dispatch_records (
    id TEXT PRIMARY KEY,
    case_no VARCHAR(50) NOT NULL,            -- 救護案號 例如 '1151007-01'
    dispatch_date VARCHAR(20) NOT NULL,      -- '115-10-07'
    vehicle VARCHAR(20) NOT NULL,            -- '博館91', '博館92'
    departure_time VARCHAR(10) NOT NULL,     -- '19:15'
    return_time VARCHAR(10) NOT NULL,        -- '20:20'
    location TEXT NOT NULL,                  -- 出勤地點
    member_ids JSONB DEFAULT '[]'::jsonb,
    member_names JSONB DEFAULT '[]'::jsonb,
    result_type VARCHAR(50) DEFAULT '送醫',  -- '送醫', '空跑 (未發現/取消)', '拒送', '現場死亡(DOA)'
    patient_count INT DEFAULT 1,             -- 服務人次
    is_idle BOOLEAN DEFAULT FALSE,           -- 是否空跑
    chief_complaint TEXT,                    -- 主訴 / 案情簡述
    treatments JSONB DEFAULT '[]'::jsonb,    -- 處置項目 (量測生命徵象, CPR, 12-Lead ECG 等)
    hospital VARCHAR(100),                   -- 送往醫院
    is_special BOOLEAN DEFAULT FALSE,        -- 是否為特殊案件 (ROSC, STEMI, 重大創傷)
    special_tag VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. 開啟 Row Level Security (RLS) 並給予公開讀寫權限 (利於全隊即時協作)
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read-write for members" ON public.members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read-write for shifts" ON public.shifts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read-write for attendance" ON public.attendance FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public read-write for dispatch_records" ON public.dispatch_records FOR ALL USING (true) WITH CHECK (true);

-- 6. 開啟 Supabase Realtime 即時廣播 (只要有人登記/取消排班，全隊即刻更新)
ALTER PUBLICATION supabase_realtime ADD TABLE public.shifts;

-- ==============================================================================
-- 7. 智慧 SQL 視圖 (Views) - 月底報表一鍵匯出核心
-- ==============================================================================

-- 視圖 A: 月底簽到退與誤餐費自動統計總表 (承辦人專用)
CREATE OR REPLACE VIEW public.view_monthly_attendance_summary AS
SELECT 
    m.id AS member_id,
    m.name AS member_name,
    m.level AS emt_level,
    SUBSTRING(a.attendance_date FROM 1 FOR 6) AS report_month,
    COUNT(a.id) AS total_shifts,
    COALESCE(SUM(a.hours), 0) AS total_hours,
    COALESCE(SUM(a.dispatches_count), 0) AS total_dispatches,
    COALESCE(SUM(a.patients_count), 0) AS total_patients,
    -- 誤餐費計算規則：每次出勤達 4 小時以上每次發給 $100 元
    COUNT(CASE WHEN a.hours >= 4 THEN 1 END) * 100 AS meal_allowance_subtotal
FROM public.members m
LEFT JOIN public.attendance a ON m.id = a.member_id
GROUP BY m.id, m.name, m.level, SUBSTRING(a.attendance_date FROM 1 FOR 6);

-- ==============================================================================
-- 8. 初始化種子資料 (12位博館義消隊員名冊)
-- ==============================================================================
INSERT INTO public.members (id, name, id_no, role, level, avatar, phone, joined_year_month, total_hours, total_dispatches, rosc_count, ecg_count, iv_count)
VALUES
('m1', '謝易庭', 'L123668055', '救護義消隊員', 'EMT-2', '👨‍🚒', '0912-345678', '111年3月', 326.5, 142, 3, 22, 31),
('m2', '林振傑', 'L124436637', '救護義消小隊長', 'EMT-P (TP)', '👨‍⚕️', '0922-888999', '108年6月', 580.0, 268, 7, 45, 68),
('m3', '張宥安', 'L126104316', '救護義消幹部', 'EMT-2', '👨‍🚒', '0933-111222', '112年1月', 245.0, 98, 2, 16, 19),
('m4', '楊雅晶', 'B222429727', '救護義消隊員', 'EMT-2', '👩‍🚒', '0955-666777', '112年5月', 198.5, 86, 1, 12, 24),
('m5', '張鎔堤', 'B123441467', '救護義消隊員', 'EMT-1', '👨‍🚒', '0966-222333', '113年2月', 142.0, 61, 1, 8, 11),
('m6', '周思瑩', 'B221850406', '救護義消隊員', 'EMT-2', '👩‍⚕️', '0977-444555', '111年9月', 289.0, 125, 4, 19, 28),
('m7', '彭凱琳', 'N224165440', '救護義消幹部', 'EMT-2', '👩‍🚒', '0988-333444', '110年8月', 412.0, 180, 5, 26, 42),
('m8', '韓寧', 'A227685019', '救護義消隊員', 'EMT-1', '👩‍🚒', '0911-777888', '113年7月', 64.0, 24, 0, 4, 3),
('m9', '陳尚璆', 'T124111810', '救護義消隊員', 'EMT-2', '👨‍🚒', '0928-999000', '112年8月', 175.5, 72, 2, 14, 15),
('m10', '洪銘聰', 'B122652653', '救護義消隊員', 'EMT-1', '👨‍🚒', '0937-123789', '113年1月', 118.0, 47, 1, 6, 8),
('m11', '黃威傑', 'B121710361', '救護義消隊員', 'EMT-2', '👨‍🚒', '0938-555666', '110年10月', 210.0, 90, 2, 11, 14),
('m12', '陳善君', 'A229489257', '救護義消隊員', 'EMT-2', '👩‍🚒', '0939-777111', '111年11月', 195.0, 82, 1, 9, 12)
ON CONFLICT (id) DO NOTHING;
