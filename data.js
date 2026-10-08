// 博館分隊救護義消協勤系統 - 初始示範資料庫
// 根據真實排班表與官方出勤紀錄表製作

export const INITIAL_MEMBERS = [
  { id: 'm0', name: '分隊警消承辦人', idNo: 'B120000001', squad: '分隊幹部', squadRole: '承辦人', role: '分隊警消承辦人', level: '分隊承辦人 (最高全域管理權限)', levelCode: '承辦人', avatar: '👮‍♂️', phone: '04-23210119', joined: '博館分隊', totalHours: 999.0, totalDispatches: 999, roscCount: 99, ecgCount: 99, ivCount: 99, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },

  // ==================== 分隊幹部 (5人) ====================
  { id: 'm13', name: '盧秋如', idNo: 'B220112341', squad: '分隊幹部', squadRole: '幹部', role: '救護義消幹部', level: 'EMT-2', levelCode: 'T2', avatar: '👩‍🚒', phone: '0910-112233', joined: '109年4月', totalHours: 380.0, totalDispatches: 160, roscCount: 4, ecgCount: 22, ivCount: 30, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm14', name: '楊明姿', idNo: 'B221234562', squad: '分隊幹部', squadRole: '幹部', role: '救護義消幹部', level: 'EMT-P (TP)', levelCode: 'TP', avatar: '👩‍⚕️', phone: '0911-223344', joined: '107年8月', totalHours: 490.0, totalDispatches: 220, roscCount: 6, ecgCount: 40, ivCount: 55, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm15', name: '邱映儒', idNo: 'B222345673', squad: '分隊幹部', squadRole: '幹部', role: '救護義消幹部', level: 'EMT-2', levelCode: 'T2', avatar: '👩‍🚒', phone: '0912-334455', joined: '110年2月', totalHours: 350.0, totalDispatches: 145, roscCount: 3, ecgCount: 18, ivCount: 25, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm16', name: '張琬琪', idNo: 'B223456784', squad: '分隊幹部', squadRole: '幹部', role: '救護義消幹部', level: 'EMT-2', levelCode: 'T2', avatar: '👩‍🚒', phone: '0913-445566', joined: '110年6月', totalHours: 340.0, totalDispatches: 138, roscCount: 3, ecgCount: 16, ivCount: 22, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm17', name: '侯士錡', idNo: 'B124567895', squad: '分隊幹部', squadRole: '幹部', role: '救護義消幹部', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0914-556677', joined: '111年1月', totalHours: 320.0, totalDispatches: 130, roscCount: 2, ecgCount: 15, ivCount: 20, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },

  // ==================== 第一小隊 (12人) ====================
  { id: 'm18', name: '鄭暐勲', idNo: 'B125678906', squad: '第一小隊', squadRole: '小隊長', role: '第一小隊小隊長', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0915-667788', joined: '108年11月', totalHours: 420.0, totalDispatches: 190, roscCount: 5, ecgCount: 28, ivCount: 36, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm10', name: '洪銘聰', idNo: 'B122652653', squad: '第一小隊', squadRole: '副小隊長', role: '第一小隊副小隊長', level: 'EMT-P (TP)', levelCode: 'TP', avatar: '👨‍⚕️', phone: '0937-123789', joined: '109年5月', totalHours: 310.0, totalDispatches: 140, roscCount: 3, ecgCount: 24, ivCount: 35, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm7',  name: '彭凱琳', idNo: 'N224165440', squad: '第一小隊', squadRole: '隊員', role: '第一小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👩‍🚒', phone: '0988-333444', joined: '110年8月', totalHours: 412.0, totalDispatches: 180, roscCount: 5, ecgCount: 26, ivCount: 42, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm19', name: '蘇怡曉', idNo: 'B226789017', squad: '第一小隊', squadRole: '隊員', role: '第一小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👩‍🚒', phone: '0916-778899', joined: '112年3月', totalHours: 195.0, totalDispatches: 82, roscCount: 1, ecgCount: 10, ivCount: 15, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm2',  name: '林振傑', idNo: 'L124436637', squad: '第一小隊', squadRole: '隊員', role: '第一小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0922-888999', joined: '108年6月', totalHours: 580.0, totalDispatches: 268, roscCount: 7, ecgCount: 45, ivCount: 68, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm20', name: '徐銘政', idNo: 'B127890128', squad: '第一小隊', squadRole: '隊員', role: '第一小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0917-889900', joined: '112年6月', totalHours: 180.0, totalDispatches: 75, roscCount: 2, ecgCount: 12, ivCount: 16, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm9',  name: '陳尚璆', idNo: 'T124111810', squad: '第一小隊', squadRole: '隊員', role: '第一小隊隊員', level: 'EMT-P (TP)', levelCode: 'TP', avatar: '👨‍⚕️', phone: '0928-999000', joined: '111年2月', totalHours: 275.5, totalDispatches: 112, roscCount: 3, ecgCount: 20, ivCount: 28, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm8',  name: '韓寧',   idNo: 'A227685019', squad: '第一小隊', squadRole: '隊員', role: '第一小隊隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👩‍🚒', phone: '0911-777888', joined: '113年7月', totalHours: 64.0, totalDispatches: 24, roscCount: 0, ecgCount: 4, ivCount: 3, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm21', name: '羅宇軒', idNo: 'B128901239', squad: '第一小隊', squadRole: '隊員', role: '第一小隊隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👨‍🚒', phone: '0918-990011', joined: '113年8月', totalHours: 72.0, totalDispatches: 28, roscCount: 0, ecgCount: 5, ivCount: 4, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm22', name: '黎珓慈', idNo: 'B229012340', squad: '第一小隊', squadRole: '隊員', role: '第一小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👩‍🚒', phone: '0919-001122', joined: '112年9月', totalHours: 160.0, totalDispatches: 68, roscCount: 1, ecgCount: 9, ivCount: 12, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm23', name: '張祐炘', idNo: 'B120123451', squad: '第一小隊', squadRole: '隊員', role: '第一小隊隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👨‍🚒', phone: '0920-112233', joined: '113年5月', totalHours: 85.0, totalDispatches: 34, roscCount: 1, ecgCount: 6, ivCount: 5, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm3',  name: '張宥安', idNo: 'L126104316', squad: '第一小隊', squadRole: '隊員', role: '第一小隊隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👨‍🚒', phone: '0933-111222', joined: '112年1月', totalHours: 245.0, totalDispatches: 98, roscCount: 2, ecgCount: 16, ivCount: 19, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },

  // ==================== 第二小隊 (10人) ====================
  { id: 'm24', name: '李忠南', idNo: 'B121234562', squad: '第二小隊', squadRole: '小隊長', role: '第二小隊小隊長', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0921-223344', joined: '107年10月', totalHours: 460.0, totalDispatches: 210, roscCount: 5, ecgCount: 30, ivCount: 40, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm1',  name: '謝易庭', idNo: 'L123668055', squad: '第二小隊', squadRole: '副小隊長', role: '第二小隊副小隊長', level: 'EMT-1', levelCode: 'T1', avatar: '👨‍🚒', phone: '0912-345678', joined: '111年3月', totalHours: 326.5, totalDispatches: 142, roscCount: 3, ecgCount: 22, ivCount: 31, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm25', name: '陳麗惠', idNo: 'B222345673', squad: '第二小隊', squadRole: '隊員', role: '第二小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👩‍🚒', phone: '0922-334455', joined: '111年8月', totalHours: 210.0, totalDispatches: 88, roscCount: 2, ecgCount: 12, ivCount: 18, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm26', name: '王政權', idNo: 'B123456784', squad: '第二小隊', squadRole: '隊員', role: '第二小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0923-445566', joined: '112年4月', totalHours: 190.0, totalDispatches: 80, roscCount: 1, ecgCount: 11, ivCount: 14, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm27', name: '楊庭豪', idNo: 'B124567895', squad: '第二小隊', squadRole: '隊員', role: '第二小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0924-556677', joined: '112年11月', totalHours: 175.0, totalDispatches: 72, roscCount: 1, ecgCount: 10, ivCount: 12, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm28', name: '游順翔', idNo: 'B125678906', squad: '第二小隊', squadRole: '隊員', role: '第二小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0925-667788', joined: '111年12月', totalHours: 205.0, totalDispatches: 86, roscCount: 2, ecgCount: 14, ivCount: 16, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm12', name: '陳善君', idNo: 'A229489257', squad: '第二小隊', squadRole: '隊員', role: '第二小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👩‍🚒', phone: '0939-777111', joined: '111年11月', totalHours: 195.0, totalDispatches: 82, roscCount: 1, ecgCount: 9, ivCount: 12, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm29', name: '林奕言', idNo: 'B126789017', squad: '第二小隊', squadRole: '隊員', role: '第二小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0926-778899', joined: '113年1月', totalHours: 165.0, totalDispatches: 68, roscCount: 1, ecgCount: 8, ivCount: 11, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm30', name: '翁妍熙', idNo: 'B227890128', squad: '第二小隊', squadRole: '隊員', role: '第二小隊隊員', level: '待訓 (新進)', levelCode: '待訓', avatar: '👩‍🚒', phone: '0927-889900', joined: '113年9月', totalHours: 25.0, totalDispatches: 8, roscCount: 0, ecgCount: 1, ivCount: 0, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm31', name: '陳柏安', idNo: 'B128901239', squad: '第二小隊', squadRole: '隊員', role: '第二小隊隊員', level: 'EMT-P (TP)', levelCode: 'TP', avatar: '👨‍⚕️', phone: '0928-990011', joined: '109年9月', totalHours: 350.0, totalDispatches: 155, roscCount: 4, ecgCount: 25, ivCount: 38, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },

  // ==================== 第三小隊 (12人) ====================
  { id: 'm32', name: '曾子庭', idNo: 'B229012340', squad: '第三小隊', squadRole: '小隊長', role: '第三小隊小隊長', level: 'EMT-2', levelCode: 'T2', avatar: '👩‍🚒', phone: '0929-001122', joined: '108年12月', totalHours: 410.0, totalDispatches: 185, roscCount: 4, ecgCount: 26, ivCount: 32, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm33', name: '林立強', idNo: 'B120123451', squad: '第三小隊', squadRole: '副小隊長', role: '第三小隊副小隊長', level: 'EMT-P (TP)', levelCode: 'TP', avatar: '👨‍⚕️', phone: '0930-112233', joined: '107年6月', totalHours: 430.0, totalDispatches: 195, roscCount: 5, ecgCount: 32, ivCount: 45, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm34', name: '杜建賢', idNo: 'B121234562', squad: '第三小隊', squadRole: '隊員', role: '第三小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0931-223344', joined: '111年5月', totalHours: 230.0, totalDispatches: 98, roscCount: 2, ecgCount: 14, ivCount: 19, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm6',  name: '周思瑩', idNo: 'B221850406', squad: '第三小隊', squadRole: '隊員', role: '第三小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👩‍⚕️', phone: '0977-444555', joined: '111年9月', totalHours: 289.0, totalDispatches: 125, roscCount: 4, ecgCount: 19, ivCount: 28, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm35', name: '張秝祺', idNo: 'B122345673', squad: '第三小隊', squadRole: '隊員', role: '第三小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0932-334455', joined: '112年7月', totalHours: 185.0, totalDispatches: 76, roscCount: 1, ecgCount: 11, ivCount: 15, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm36', name: '孫雁鴻', idNo: 'B123456784', squad: '第三小隊', squadRole: '隊員', role: '第三小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0933-445566', joined: '111年10月', totalHours: 215.0, totalDispatches: 92, roscCount: 2, ecgCount: 13, ivCount: 17, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm37', name: '葉冠遠', idNo: 'B124567895', squad: '第三小隊', squadRole: '隊員', role: '第三小隊隊員', level: 'EMT-P (TP)', levelCode: 'TP', avatar: '👨‍⚕️', phone: '0934-556677', joined: '109年3月', totalHours: 360.0, totalDispatches: 160, roscCount: 4, ecgCount: 27, ivCount: 40, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm38', name: '林冠廷', idNo: 'B125678906', squad: '第三小隊', squadRole: '隊員', role: '第三小隊隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👨‍🚒', phone: '0935-667788', joined: '113年3月', totalHours: 92.0, totalDispatches: 38, roscCount: 0, ecgCount: 5, ivCount: 6, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm39', name: '廖采柔', idNo: 'B226789017', squad: '第三小隊', squadRole: '隊員', role: '第三小隊隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👩‍🚒', phone: '0936-778899', joined: '113年4月', totalHours: 88.0, totalDispatches: 35, roscCount: 0, ecgCount: 4, ivCount: 5, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm40', name: '沈芳綺', idNo: 'B227890128', squad: '第三小隊', squadRole: '隊員', role: '第三小隊隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👩‍🚒', phone: '0937-889900', joined: '113年6月', totalHours: 76.0, totalDispatches: 30, roscCount: 0, ecgCount: 4, ivCount: 4, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm11', name: '黃威傑', idNo: 'B121710361', squad: '第三小隊', squadRole: '隊員', role: '第三小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0938-555666', joined: '110年10月', totalHours: 210.0, totalDispatches: 90, roscCount: 2, ecgCount: 11, ivCount: 14, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm41', name: '何俊宏', idNo: 'B128901239', squad: '第三小隊', squadRole: '隊員', role: '第三小隊隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0939-990011', joined: '112年5月', totalHours: 195.0, totalDispatches: 84, roscCount: 1, ecgCount: 12, ivCount: 16, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },

  // ==================== 中區 (15人) ====================
  { id: 'm5',  name: '張鎔堤', idNo: 'B123441467', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👨‍🚒', phone: '0966-222333', joined: '113年2月', totalHours: 142.0, totalDispatches: 61, roscCount: 1, ecgCount: 8, ivCount: 11, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm42', name: '陳志明', idNo: 'B129012340', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-P (TP)', levelCode: 'TP', avatar: '👨‍⚕️', phone: '0940-001122', joined: '108年4月', totalHours: 370.0, totalDispatches: 165, roscCount: 5, ecgCount: 28, ivCount: 42, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm43', name: '李宜臻', idNo: 'B220123451', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👩‍🚒', phone: '0941-112233', joined: '113年2月', totalHours: 95.0, totalDispatches: 38, roscCount: 0, ecgCount: 6, ivCount: 6, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm44', name: '黃柔迦', idNo: 'B221234562', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👩‍🚒', phone: '0942-223344', joined: '113年3月', totalHours: 85.0, totalDispatches: 32, roscCount: 0, ecgCount: 5, ivCount: 5, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm45', name: '宋依純', idNo: 'B222345673', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-P (TP)', levelCode: 'TP', avatar: '👩‍⚕️', phone: '0943-334455', joined: '107年11月', totalHours: 390.0, totalDispatches: 172, roscCount: 4, ecgCount: 30, ivCount: 44, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm46', name: '張凱菱', idNo: 'B223456784', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-P (TP)', levelCode: 'TP', avatar: '👩‍⚕️', phone: '0944-445566', joined: '108年1月', totalHours: 385.0, totalDispatches: 170, roscCount: 4, ecgCount: 29, ivCount: 43, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm47', name: '簡綉蓉', idNo: 'B224567895', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-2', levelCode: 'T2', avatar: '👩‍🚒', phone: '0945-556677', joined: '111年4月', totalHours: 220.0, totalDispatches: 95, roscCount: 2, ecgCount: 14, ivCount: 18, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm48', name: '田壬婕', idNo: 'B225678906', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👩‍🚒', phone: '0946-667788', joined: '113年4月', totalHours: 78.0, totalDispatches: 31, roscCount: 0, ecgCount: 4, ivCount: 4, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm49', name: '林瑀嬛', idNo: 'B226789017', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👩‍🚒', phone: '0947-778899', joined: '113年5月', totalHours: 82.0, totalDispatches: 34, roscCount: 0, ecgCount: 5, ivCount: 5, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm4',  name: '楊雅晶', idNo: 'B222429727', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👩‍🚒', phone: '0955-666777', joined: '112年5月', totalHours: 198.5, totalDispatches: 86, roscCount: 1, ecgCount: 12, ivCount: 24, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm50', name: '楊博安', idNo: 'B127890128', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👨‍🚒', phone: '0948-889900', joined: '113年6月', totalHours: 90.0, totalDispatches: 36, roscCount: 1, ecgCount: 6, ivCount: 6, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm51', name: '林芳儀', idNo: 'B228901239', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👩‍🚒', phone: '0949-990011', joined: '113年7月', totalHours: 75.0, totalDispatches: 29, roscCount: 0, ecgCount: 4, ivCount: 4, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm52', name: '陳筠今', idNo: 'B229012340', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👩‍🚒', phone: '0950-001122', joined: '113年8月', totalHours: 88.0, totalDispatches: 35, roscCount: 0, ecgCount: 5, ivCount: 5, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm53', name: '游定璇', idNo: 'B220123451', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👩‍🚒', phone: '0951-112233', joined: '113年8月', totalHours: 70.0, totalDispatches: 26, roscCount: 0, ecgCount: 3, ivCount: 4, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' },
  { id: 'm54', name: '莊雅茵', idNo: 'B221234562', squad: '中區', squadRole: '隊員', role: '中區協勤隊員', level: 'EMT-1', levelCode: 'T1', avatar: '👩‍🚒', phone: '0952-223344', joined: '113年9月', totalHours: 85.0, totalDispatches: 33, roscCount: 0, ecgCount: 5, ivCount: 5, isRestricted: false, restrictionUntil: null, makeupTrainingStatus: 'eligible' }
];

export const INITIAL_ATTENDANCE = [
  { id: 'att-1', memberId: 'm1', memberName: '謝易庭', date: '115-10-01', signIn: '18:00', signOut: '23:00', hours: 5.0, dispatches: 2, patients: 2, note: '自排班救護協勤 (隊上待命)' },
  { id: 'att-2', memberId: 'm2', memberName: '林振傑', date: '115-10-02', signIn: '07:00', signOut: '18:00', hours: 11.0, dispatches: 4, patients: 3, note: '全日救護協勤 (TP專責支援)' },
  { id: 'att-3', memberId: 'm6', memberName: '周思瑩', date: '115-10-03', signIn: '08:00', signOut: '15:00', hours: 7.0, dispatches: 3, patients: 3, note: '假日早班協勤' },
  { id: 'att-4', memberId: 'm4', memberName: '楊雅晶', date: '115-10-06', signIn: '18:00', signOut: '23:00', hours: 5.0, dispatches: 1, patients: 1, note: '夜間協勤' },
  { id: 'att-5', memberId: 'm5', memberName: '張鎔堤', date: '115-10-06', signIn: '11:00', signOut: '23:00', hours: 12.0, dispatches: 5, patients: 4, note: '假日跨班協勤' },
  { id: 'att-6', memberId: 'm3', memberName: '張宥安', date: '115-10-04', signIn: '14:00', signOut: '18:00', hours: 4.0, dispatches: 1, patients: 1, note: '補定訓值班' },
  { id: 'att-7', memberId: 'm7', memberName: '彭凱琳', date: '115-10-08', signIn: '13:00', signOut: '20:00', hours: 7.0, dispatches: 3, patients: 2, note: '幹部值班協勤' },
  { id: 'att-8', memberId: 'm1', memberName: '謝易庭', date: '115-10-05', signIn: '18:00', signOut: '23:00', hours: 5.0, dispatches: 2, patients: 2, note: '夜間救護協勤 (隊上待命)' },
  { id: 'att-9', memberId: 'm10', memberName: '洪銘聰', date: '115-10-08', signIn: '13:00', signOut: '20:00', hours: 7.0, dispatches: 2, patients: 2, note: '白班協勤' },
  { id: 'att-10', memberId: 'm1', memberName: '謝易庭', date: '115-10-07', signIn: '18:00', signOut: '23:00', hours: 5.0, dispatches: 3, patients: 3, note: '自排班救護協勤' }
];

export const INITIAL_DISPATCHES = [];

export const INITIAL_SHIFTS = [];

export const BADGE_DEFINITIONS = [
  {
    id: 'b-1',
    name: '救護百役',
    category: '出勤里程碑',
    icon: '🏆',
    description: '累計跟隨博館救護車出勤超過 100 趟次',
    threshold: 100,
    unit: '次出勤',
    field: 'totalDispatches',
    color: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.4)'
  },
  {
    id: 'b-2',
    name: '逆轉死神 (ROSC)',
    category: '急救奇蹟',
    icon: '⚡',
    description: '參與現場心肺復甦術並成功於現場或途中恢復自發性心跳 (ROSC)',
    threshold: 1,
    unit: '件急救成功',
    field: 'roscCount',
    color: '#ef4444',
    glow: 'rgba(239, 68, 68, 0.4)'
  },
  {
    id: 'b-3',
    name: '神之心眼 (ECG)',
    category: '專業技能',
    icon: '📈',
    description: '精準操作執行 12 導程心電圖並完成雲端即時判讀傳輸累計 20 例',
    threshold: 20,
    unit: '例ECG',
    field: 'ecgCount',
    color: '#06b6d4',
    glow: 'rgba(6, 182, 212, 0.4)'
  },
  {
    id: 'b-4',
    name: '穿針引線 (IV)',
    category: '救護進階處置',
    icon: '💉',
    description: '重症或創傷急救中成功協助或建立靜脈輸液途徑累計 25 例',
    threshold: 25,
    unit: '例靜脈注射',
    field: 'ivCount',
    color: '#8b5cf6',
    glow: 'rgba(139, 92, 246, 0.4)'
  },
  {
    id: 'b-5',
    name: '守護常勝軍',
    category: '奉獻時數',
    icon: '🛡️',
    description: '年度協勤總時數突破 200 小時，分隊守護中流砥柱',
    threshold: 200,
    unit: '小時協勤',
    field: 'totalHours',
    color: '#10b981',
    glow: 'rgba(16, 185, 129, 0.4)'
  },
  {
    id: 'b-6',
    name: '傳奇鳳凰 (500HR)',
    category: '終身奉獻',
    icon: '👑',
    description: '協勤總時數跨越 500 小時榮譽殿堂',
    threshold: 500,
    unit: '小時協勤',
    field: 'totalHours',
    color: '#ec4899',
    glow: 'rgba(236, 72, 153, 0.4)'
  }
];


export const SQUAD_CONFIG = [
  { id: 'squad-cadre', name: '分隊幹部', icon: '🏛️', leader: '分隊幹部群', desc: '隊務策劃、訓練指導與協勤行政督導', badgeColor: '#f59e0b' },
  { id: 'squad-1', name: '第一小隊', icon: '🚒', leader: '鄭暐勲 (小隊長)', deputy: '洪銘聰 (副小隊長)', desc: '第一救護協勤責任分組', badgeColor: '#06b6d4' },
  { id: 'squad-2', name: '第二小隊', icon: '🚒', leader: '李忠南 (小隊長)', deputy: '謝易庭 (副小隊長)', desc: '第二救護協勤責任分組', badgeColor: '#10b981' },
  { id: 'squad-3', name: '第三小隊', icon: '🚒', leader: '曾子庭 (小隊長)', deputy: '林立強 (副小隊長)', desc: '第三救護協勤責任分組', badgeColor: '#8b5cf6' },
  { id: 'squad-central', name: '中區', icon: '🚒', leader: '中區協勤組', desc: '中區責任區域協勤支援同仁', badgeColor: '#38bdf8' }
];
