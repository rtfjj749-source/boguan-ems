import { INITIAL_MEMBERS, INITIAL_ATTENDANCE, INITIAL_DISPATCHES, INITIAL_SHIFTS, BADGE_DEFINITIONS, SQUAD_CONFIG, INITIAL_ANNOUNCEMENTS } from './data.js?v=20261009_v35';

// ==========================================
// 1. 資料持久化管理 (LocalStorage)
// ==========================================
class Store {
  static get(key, fallback) {
    try {
      const data = localStorage.getItem(`ems_${key}`);
      return data ? JSON.parse(data) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  static set(key, value) {
    try {
      localStorage.setItem(`ems_${key}`, JSON.stringify(value));
    } catch (e) {
      console.error(e);
    }
  }
}

function syncOfficialMembers(storedList) {
  const storedMap = new Map();
  if (Array.isArray(storedList)) {
    storedList.forEach(m => {
      if (m && m.name) storedMap.set(m.name, m);
      if (m && m.id) storedMap.set(m.id, m);
    });
  }

  const result = INITIAL_MEMBERS.map(official => {
    const existing = storedMap.get(official.id) || storedMap.get(official.name);
    if (existing) {
      return {
        ...official,
        totalHours: existing.totalHours !== undefined ? existing.totalHours : official.totalHours,
        totalDispatches: existing.totalDispatches !== undefined ? existing.totalDispatches : official.totalDispatches,
        roscCount: existing.roscCount !== undefined ? existing.roscCount : official.roscCount,
        ecgCount: existing.ecgCount !== undefined ? existing.ecgCount : official.ecgCount,
        ivCount: existing.ivCount !== undefined ? existing.ivCount : official.ivCount,
        phone: existing.phone || official.phone,
        joined: existing.joined || official.joined,
        isRestricted: existing.isRestricted !== undefined ? existing.isRestricted : official.isRestricted,
        restrictionUntil: existing.restrictionUntil !== undefined ? existing.restrictionUntil : official.restrictionUntil,
        makeupTrainingStatus: existing.makeupTrainingStatus || official.makeupTrainingStatus,
        idNo: existing.idNo || official.idNo,
        status: existing.status || 'active',
        retiredDate: existing.retiredDate || null,
        retiredReason: existing.retiredReason || '',
        squad: existing.squad || official.squad,
        squadRole: existing.squadRole || official.squadRole,
        role: existing.role || official.role,
        level: existing.level || official.level,
        levelCode: existing.levelCode || official.levelCode,
        avatar: existing.avatar || official.avatar
      };
    }
    return { ...official, status: 'active', retiredDate: null, retiredReason: '' };
  });

  // 保留承辦人由介面動態新增的自訂義消人員
  if (Array.isArray(storedList)) {
    storedList.forEach(m => {
      if (m && m.id && !result.some(r => r.id === m.id)) {
        result.push({
          ...m,
          status: m.status || 'active',
          retiredDate: m.retiredDate || null,
          retiredReason: m.retiredReason || ''
        });
      }
    });
  }

  return result;
}

// 一次性全面清空舊版測試資料快取（出勤、排班、簽到退、取消日誌、同仁歷史數據全歸零）
if (!Store.get('clean_data_reset_v6')) {
  Store.set('attendance', []);
  Store.set('dispatches', []);
  Store.set('shifts', []);
  Store.set('cancellation_logs', []);
  Store.set('activeDuty', null);
  Store.set('members', INITIAL_MEMBERS);
  Store.set('clean_data_reset_v6', true);
}

let members = syncOfficialMembers(Store.get('members', INITIAL_MEMBERS));
Store.set('members', members);

let attendance = Store.get('attendance', INITIAL_ATTENDANCE);
Store.set('attendance', attendance);

let dispatches = Store.get('dispatches', INITIAL_DISPATCHES);
Store.set('dispatches', dispatches);

let shifts = Store.get('shifts', INITIAL_SHIFTS)
  .filter(s => s.memberName && s.status !== '缺協勤' && s.vehicle !== '分隊公告' && s.vehicle !== '系統帳號')
  .map(s => {
    let v = s.vehicle;
    if (!v || v === '博館91' || v === '博館92' || v.includes('91') || v.includes('92')) {
      v = '救護協勤';
    }
    return { ...s, vehicle: v };
  });
Store.set('shifts', shifts);

let currentAuthUser = Store.get('current_auth_user', null);
let currentMemberId = currentAuthUser ? currentAuthUser.memberId : null;
let activeDuty = Store.get('activeDuty', null);
let cancellationLogs = Store.get('cancellation_logs', []);
Store.set('cancellation_logs', cancellationLogs);
let announcements = Store.get('announcements', null);
if (!announcements || !Array.isArray(announcements) || announcements.length === 0) {
  announcements = Array.isArray(INITIAL_ANNOUNCEMENTS) ? [...INITIAL_ANNOUNCEMENTS] : [];
  Store.set('announcements', announcements);
}
let showHistoryAnnouncements = false;

// 跨視窗/跨分頁/跨帳號零延遲即時同步廣播通道 (BroadcastChannel)
let emsSyncChannel = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    emsSyncChannel = new BroadcastChannel('ems_sync_broadcast_channel');
    emsSyncChannel.onmessage = (event) => {
      if (event.data && event.data.type === 'REFRESH_ALL') {
        attendance = Store.get('attendance', []);
        dispatches = Store.get('dispatches', []);
        announcements = Store.get('announcements', []);
        members = syncOfficialMembers(Store.get('members', []));
        shifts = Store.get('shifts', []).filter(s => s.vehicle !== '分隊公告' && s.vehicle !== '系統帳號');
        activeDuty = Store.get('activeDuty', null);
        const updatedAuth = Store.get('current_auth_user', null);
        if (updatedAuth) currentAuthUser = updatedAuth;
        updateUserNavbarUi();
        updateAllViews();
      }
    };
  }
} catch (e) {
  console.warn('BroadcastChannel init notice:', e);
}

function notifyCrossTabSync() {
  try {
    emsSyncChannel?.postMessage({ type: 'REFRESH_ALL', timestamp: Date.now() });
  } catch (e) {}
}

// 跨分頁即時同步監聽 (同一瀏覽器不同分頁或身分登入即時連動)
window.addEventListener('storage', (e) => {
  if (!e.key || !e.key.startsWith('ems_')) return;
  if (e.key === 'ems_attendance') {
    attendance = Store.get('attendance', []);
  } else if (e.key === 'ems_dispatches') {
    dispatches = Store.get('dispatches', []);
  } else if (e.key === 'ems_announcements') {
    announcements = Store.get('announcements', []);
  } else if (e.key === 'ems_members') {
    members = syncOfficialMembers(Store.get('members', []));
  } else if (e.key === 'ems_shifts') {
    shifts = Store.get('shifts', []);
  } else if (e.key === 'ems_activeDuty') {
    activeDuty = Store.get('activeDuty', null);
  }
  updateAllViews();
});

// ==========================================
// 1.1 Supabase 雲端客戶端與全模組即時同步引擎
// ==========================================
let supabaseClient = null;
const SUPABASE_CONFIG = {
  url: Store.get('supabase_url', 'https://qtwimetfuteluwvjdtql.supabase.co'),
  key: Store.get('supabase_key', 'sb_publishable_aq-ILtmUEsw-GH064k0ODA_GlHeMIMb')
};

function initSupabase() {
  if (window.supabase && SUPABASE_CONFIG.url && SUPABASE_CONFIG.key) {
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
      updateCloudIndicator(true);
      setupSupabaseRealtime();
      syncFromSupabase();
      syncAttendanceFromSupabase();
      syncDispatchesFromSupabase();
      syncUserAccountsFromSupabase();
      startAutoBackgroundSync();
      return true;
    } catch (e) {
      console.warn('Supabase init failed:', e);
      updateCloudIndicator(false);
      return false;
    }
  } else {
    updateCloudIndicator(false);
    return false;
  }
}

function updateCloudIndicator(isConnected) {
  const btn = document.getElementById('cloudStatusIndicator');
  const badge = document.getElementById('supabaseStatusBadge');
  if (btn) {
    btn.innerHTML = isConnected ? '🟢 雲端同步中' : '☁️ 雲端同步';
  }
  if (badge) {
    badge.textContent = isConnected ? '🟢 已連線至 Supabase 雲端資料庫 (即時雙向同步已啟動)' : '🟡 本地暫存模式 (LocalStorage)';
    badge.style.background = isConnected ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)';
    badge.style.color = isConnected ? '#34d399' : '#fbbf24';
    badge.style.borderColor = isConnected ? '#10b981' : 'rgba(245,158,11,0.4)';
  }
}

// 1. 排班表與雲端公告同步
async function syncFromSupabase() {
  if (!supabaseClient) return;
  try {
    const { data: remoteShifts, error: sErr } = await supabaseClient.from('shifts').select('*');
    if (!sErr && remoteShifts) {
      // 排班紀錄 (排除公告與帳號備份)
      shifts = remoteShifts
        .filter(s => s.member_name && s.status !== '缺協勤' && s.vehicle !== '分隊公告' && s.vehicle !== '系統帳號')
        .map(s => {
          let v = s.vehicle;
          if (!v || v === '博館91' || v === '博館92' || v.includes('91') || v.includes('92')) {
            v = '救護協勤';
          }
          return {
            id: s.id,
            date: s.shift_date,
            day: s.day_num,
            dayOfWeek: s.day_of_week,
            vehicle: v,
            period: s.period,
            memberName: s.member_name || '',
            shiftType: s.shift_type,
            status: s.status,
            isMakeupTraining: !!s.is_makeup_training
          };
        });
      Store.set('shifts', shifts);
      renderSchedule();

      // 雲端公告提取與同步
      const remoteAnns = [];
      remoteShifts.filter(s => s.vehicle === '分隊公告').forEach(row => {
        try {
          if (row.notes) {
            const parsed = JSON.parse(row.notes);
            if (parsed && parsed.title) remoteAnns.push(parsed);
          }
        } catch (e) {}
      });
      if (remoteAnns.length > 0) {
        announcements = remoteAnns;
        Store.set('announcements', announcements);
        renderAnnouncements();
      }

      // 同步提取帳號安全備份
      if (remoteShifts.some(s => s.vehicle === '系統帳號')) {
        syncUserAccountsFromSupabase();
      }

      // 同步清理雲端多餘的缺協勤/空紀錄
      if (remoteShifts.length > 0) {
        supabaseClient.from('shifts').delete().or('status.eq.缺協勤,member_name.eq.""').then(() => {});
      }
    }
  } catch (err) {
    console.warn('Sync from Supabase shifts failed:', err);
  }
}

// 2. 簽到退紀錄與在隊狀態同步 (Attendance)
async function syncAttendanceFromSupabase() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from('attendance').select('*').order('attendance_date', { ascending: false });
    if (!error && data && data.length > 0) {
      const todayStr = getCurrentRocDate();
      const prevActiveNames = new Set(
        attendance
          .filter(a => normalizeRocDateStr(a.date) === normalizeRocDateStr(todayStr) && (!a.signOut || a.signOut === '' || a.signOut === '—'))
          .map(a => a.memberName)
      );

      attendance = data.map(r => ({
        id: r.id,
        memberId: r.member_id,
        memberName: r.member_name,
        date: r.attendance_date,
        signIn: r.sign_in_time,
        signOut: r.sign_out_time || '',
        hours: Number(r.hours) || 0,
        dispatches: Number(r.dispatches_count) || 0,
        patients: Number(r.patients_count) || 0,
        note: r.notes || ''
      }));
      Store.set('attendance', attendance);
      renderRecentAttendance();
      updateTodayStatus();
      updateDutyHero();

      // 跨裝置即時提醒：若有新義消同仁在其他裝置打卡到隊，值班台電腦自動跳出即時通知
      if (prevActiveNames.size > 0) {
        const currentActive = attendance.filter(a => normalizeRocDateStr(a.date) === normalizeRocDateStr(todayStr) && (!a.signOut || a.signOut === '' || a.signOut === '—'));
        const newlyArrived = currentActive.filter(a => !prevActiveNames.has(a.memberName));
        if (newlyArrived.length > 0) {
          const names = newlyArrived.map(a => a.memberName).join('、');
          showToast(`🔔 義消同仁【${names}】已於手機完成簽到，在隊名冊已同步更新！`, '👨‍🚒');
          playFeedbackSound('success');
        }
      }
    }
  } catch (e) {
    console.warn('Sync attendance error:', e);
  }
}

// 3. 救護出勤紀錄同步 (Dispatch Records)
async function syncDispatchesFromSupabase() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.from('dispatch_records').select('*').order('dispatch_date', { ascending: false });
    if (!error && data && data.length > 0) {
      dispatches = data.map(r => ({
        id: r.id,
        caseNo: r.case_no,
        date: r.dispatch_date,
        vehicle: r.vehicle,
        departureTime: r.departure_time,
        returnTime: r.return_time,
        location: r.location,
        memberIds: r.member_ids || [],
        memberNames: r.member_names || [],
        resultType: r.result_type,
        patientCount: r.patient_count || 1,
        isIdle: !!r.is_idle,
        chiefComplaint: r.chief_complaint || '',
        treatments: r.treatments || [],
        hospital: r.hospital || '無',
        isSpecial: !!r.is_special,
        specialTag: r.special_tag || ''
      }));
      Store.set('dispatches', dispatches);
      renderDispatchList();
      updateTodayStatus();
      renderSummaryReports();
      renderOfficerExecutiveDashboard();
    }
  } catch (e) {
    console.warn('Sync dispatches error:', e);
  }
}

// 4. 義消帳號與自訂密碼多裝置即時同步 (User Accounts)
async function syncUserAccountsFromSupabase() {
  if (!supabaseClient) return;
  try {
    let remoteAccounts = [];

    // 1. 嘗試由 public.user_accounts 資料表載入
    try {
      const { data, error } = await supabaseClient.from('user_accounts').select('*');
      if (!error && data && data.length > 0) {
        remoteAccounts = data.map(r => ({
          id: r.id,
          username: r.username,
          memberId: r.member_id,
          name: r.name,
          password: r.password_hash,
          hasChangedPassword: !!r.has_changed_password,
          passwordChangedAt: r.password_changed_at,
          isAdmin: !!r.is_admin
        }));
      }
    } catch (e) {
      console.warn('Sync from user_accounts table note:', e);
    }

    // 2. 雙軌讀取：若無資料，從 shifts 備份 (vehicle='系統帳號') 載入
    try {
      const { data: bData, error: bErr } = await supabaseClient
        .from('shifts')
        .select('*')
        .eq('vehicle', '系統帳號');
      if (!bErr && bData && bData.length > 0) {
        bData.forEach(row => {
          if (row.notes) {
            try {
              const parsed = JSON.parse(row.notes);
              if (parsed && parsed.username && parsed.password) {
                const existing = remoteAccounts.find(a => a.username === parsed.username);
                if (!existing) {
                  remoteAccounts.push(parsed);
                } else if (parsed.hasChangedPassword && !existing.hasChangedPassword) {
                  existing.password = parsed.password;
                  existing.hasChangedPassword = true;
                }
              }
            } catch (e) {}
          }
        });
      }
    } catch (e) {
      console.warn('Sync from shifts backup note:', e);
    }

    // 3. 合併遠端帳號至本機 LocalStorage
    if (remoteAccounts.length > 0) {
      const localAccs = getUserAccounts();
      let hasChanges = false;
      remoteAccounts.forEach(rem => {
        const local = localAccs.find(a => a.username === rem.username || (rem.memberId && a.memberId === rem.memberId));
        if (local) {
          if (rem.hasChangedPassword && (!local.hasChangedPassword || local.password !== rem.password)) {
            local.password = rem.password;
            local.hasChangedPassword = true;
            local.passwordChangedAt = rem.passwordChangedAt || local.passwordChangedAt;
            hasChanges = true;
          } else if (!rem.hasChangedPassword && local.hasChangedPassword && local.password === '1234') {
            local.hasChangedPassword = false;
            hasChanges = true;
          }
        }
      });

      if (hasChanges) {
        Store.set('user_accounts', localAccs);
        if (currentAuthUser) {
          const updatedCur = localAccs.find(a => a.username === currentAuthUser.username);
          if (updatedCur) {
            currentAuthUser = updatedCur;
            Store.set('current_auth_user', currentAuthUser);
          }
        }
        renderAdminPasswordTrackingTable();
      }
    }
  } catch (err) {
    console.warn('syncUserAccountsFromSupabase error:', err);
  }
}

// 推播單一帳號與新密碼至 Supabase (雙軌保險寫入)
async function pushUserAccountToSupabase(acc) {
  if (!acc) return;
  const allAccs = getUserAccounts();
  const idx = allAccs.findIndex(a => a.username === acc.username || a.memberId === acc.memberId);
  if (idx >= 0) {
    allAccs[idx] = { ...allAccs[idx], ...acc };
  } else {
    allAccs.push(acc);
  }
  Store.set('user_accounts', allAccs);

  if (!supabaseClient) return;

  // 1. 寫入 user_accounts 資料表
  try {
    await supabaseClient.from('user_accounts').upsert({
      id: acc.id || `acc-${acc.memberId || acc.username}`,
      username: acc.username,
      member_id: acc.memberId || null,
      name: acc.name,
      password_hash: acc.password,
      has_changed_password: !!acc.hasChangedPassword,
      password_changed_at: new Date().toISOString(),
      is_admin: !!acc.isAdmin
    }, { onConflict: 'username' });
  } catch (err) {
    console.warn('Push to user_accounts table note:', err);
  }

  // 2. 雙軌備份至 shifts 資料表 (確保零設定也能 100% 跨手機、電腦同步)
  try {
    const backupId = `sec-acc-${acc.memberId || acc.username}`;
    await supabaseClient.from('shifts').upsert({
      id: backupId,
      shift_date: '2099-12-31',
      day_num: 31,
      day_of_week: '日',
      vehicle: '系統帳號',
      period: '全日',
      member_name: acc.username,
      shift_type: acc.isAdmin ? 'ADMIN' : 'VOLUNTEER',
      status: acc.hasChangedPassword ? 'CHANGED' : 'DEFAULT',
      notes: JSON.stringify({
        id: acc.id || backupId,
        username: acc.username,
        name: acc.name,
        memberId: acc.memberId,
        password: acc.password,
        hasChangedPassword: acc.hasChangedPassword,
        passwordChangedAt: acc.passwordChangedAt || new Date().toLocaleString('zh-TW'),
        isAdmin: acc.isAdmin
      })
    }, { onConflict: 'id' });
  } catch (err) {
    console.warn('Backup to shifts note:', err);
  }
}

// 建立 Realtime 即時推播監聽 (全域多裝置跨頁廣播)
function setupSupabaseRealtime() {
  if (!supabaseClient) return;
  try {
    // 監聽排班表與公告異動
    supabaseClient
      .channel('public:shifts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, () => {
        syncFromSupabase();
      })
      .subscribe();

    // 監聽簽到打卡與在隊狀態異動
    supabaseClient
      .channel('public:attendance')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => {
        syncAttendanceFromSupabase();
      })
      .subscribe();

    // 監聽救護出勤案件登記與修改
    supabaseClient
      .channel('public:dispatch_records')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatch_records' }, () => {
        syncDispatchesFromSupabase();
      })
      .subscribe();

    // 監聽帳號與自訂密碼異動
    supabaseClient
      .channel('public:user_accounts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_accounts' }, () => {
        syncUserAccountsFromSupabase();
      })
      .subscribe();
  } catch (e) {
    console.warn('Realtime subscription error:', e);
  }
}

// 全自動背景靜默同步引擎 (確保跨裝置手機簽到後，警消電腦完全免按 F5 即時更新)
let backgroundSyncTimer = null;
function startAutoBackgroundSync() {
  if (backgroundSyncTimer) clearInterval(backgroundSyncTimer);

  // 每 8 秒背景靜默同步最新簽到退與出勤狀態
  backgroundSyncTimer = setInterval(() => {
    if (supabaseClient) {
      syncAttendanceFromSupabase();
      syncDispatchesFromSupabase();
    }
  }, 8000);

  // 當使用者點回瀏覽器分頁、視窗獲得焦點、或螢幕喚醒時，立即自動觸發一次同步
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && supabaseClient) {
      syncAttendanceFromSupabase();
      syncDispatchesFromSupabase();
      syncFromSupabase();
    }
  });

  window.addEventListener('focus', () => {
    if (supabaseClient) {
      syncAttendanceFromSupabase();
      syncDispatchesFromSupabase();
    }
  });
}

// 將排班變更推至 Supabase
function pushShiftToSupabase(shift) {
  if (!supabaseClient) return;
  supabaseClient.from('shifts').upsert({
    id: shift.id,
    shift_date: shift.date,
    day_num: shift.day,
    day_of_week: shift.dayOfWeek,
    vehicle: shift.vehicle,
    period: shift.period,
    member_name: shift.memberName || '',
    shift_type: shift.shiftType,
    status: shift.status,
    is_makeup_training: !!shift.isMakeupTraining
  }).then(({ error }) => {
    if (error) console.warn('Supabase shift upsert error:', error);
  });
}

function deleteShiftFromSupabase(shiftId) {
  if (!supabaseClient || !shiftId) return;
  supabaseClient.from('shifts').delete().eq('id', shiftId).then(({ error }) => {
    if (error) console.warn('Supabase shift delete error:', error);
  });
}

// 將出勤紀錄推至 Supabase
function pushDispatchToSupabase(d) {
  if (!supabaseClient) return;
  try {
    supabaseClient.from('dispatch_records').upsert({
      id: d.id,
      case_no: d.caseNo,
      dispatch_date: d.date,
      vehicle: d.vehicle,
      departure_time: d.departureTime,
      return_time: d.returnTime,
      location: d.location,
      member_ids: d.memberIds || [],
      member_names: d.memberNames || [],
      result_type: d.resultType,
      patient_count: d.patientCount || 1,
      is_idle: !!d.isIdle,
      chief_complaint: d.chiefComplaint || '',
      treatments: d.treatments || [],
      hospital: d.hospital || '無',
      is_special: !!d.isSpecial,
      special_tag: d.specialTag || ''
    }).then(({ error }) => {
      if (error) console.warn('Supabase dispatch upsert error:', error);
    });
  } catch (e) {
    console.warn(e);
  }
}

function deleteDispatchFromSupabase(id) {
  if (!supabaseClient) return;
  try {
    supabaseClient.from('dispatch_records').delete().eq('id', id).then(() => {});
  } catch (e) {}
}

// 將簽到退紀錄推至 Supabase
function pushAttendanceToSupabase(a) {
  if (!supabaseClient) return;
  try {
    supabaseClient.from('attendance').upsert({
      id: a.id,
      member_id: null, // 避免雲端 members 表為空時觸發 foreign key violation
      member_name: a.memberName,
      attendance_date: a.date,
      sign_in_time: a.signIn,
      sign_out_time: a.signOut || '',
      hours: Number(a.hours) || 0,
      dispatches_count: Number(a.dispatches) || 0,
      patients_count: Number(a.patients) || 0,
      notes: a.note || ''
    }).then(({ error }) => {
      if (error) console.warn('Supabase attendance upsert error:', error);
    });
  } catch (e) {
    console.warn(e);
  }
}

// 將公告推至 Supabase
function pushAnnouncementToSupabase(ann) {
  if (!supabaseClient) return;
  try {
    supabaseClient.from('shifts').upsert({
      id: ann.id,
      shift_date: ann.createdDateStr ? ann.createdDateStr.split(' ')[0] : getCurrentRocDate(),
      day_num: 0,
      day_of_week: '',
      vehicle: '分隊公告',
      period: ann.endDate || '',
      member_name: ann.author || '分隊警消承辦人',
      shift_type: '公告',
      status: ann.priority || 'NORMAL',
      notes: JSON.stringify(ann)
    }).then(() => {});
  } catch (e) {}
}

function deleteAnnouncementFromSupabase(annId) {
  if (!supabaseClient) return;
  try {
    supabaseClient.from('shifts').delete().eq('id', annId).then(() => {});
  } catch (e) {}
}

// ==========================================
// 2. 音效回饋 (Web Audio API)
// ==========================================
function playFeedbackSound(type = 'success') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success') {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(330, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (e) {
    // ignore audio block
  }
}

// Toast 提示工具
function showToast(msg, icon = '✅') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ==========================================
// 3. UI 渲染核心函數
// ==========================================
function getCurrentMember() {
  if (currentMemberId) {
    const found = members.find(m => m.id === currentMemberId);
    if (found) return found;
  }
  return {
    id: 'guest',
    name: '未登入',
    role: '訪客',
    squad: '未登入',
    squadRole: '訪客',
    level: '訪客',
    isRestricted: false,
    phone: '',
    joined: '',
    totalHours: 0,
    totalDispatches: 0,
    roscCount: 0,
    ecgCount: 0,
    ivCount: 0
  };
}

// 判斷當前是否已有使用者通過身分驗證登入
function isLoggedIn() {
  return !!currentAuthUser && currentMemberId !== null && currentMemberId !== 'guest';
}

// 判斷當前登入者是否具備分隊警消承辦人最高管理權限
function isSuperAdmin() {
  if (!currentAuthUser) return false;
  return currentAuthUser.isAdmin || currentAuthUser.username === '博館' || currentMemberId === 'm0';
}

// 判斷當前登入者是否具備小隊幹部或警消承辦人權限
function isCurrentOfficer() {
  const m = getCurrentMember();
  if (!m) return false;
  return isSuperAdmin() || m.role.includes('幹部') || m.role.includes('小隊長') || m.role.includes('助理') || 
         m.name === '林振傑' || m.name === '張宥安' || m.name === '彭凱琳';
}

// 判斷當前使用者是否具備修改該筆救護出勤紀錄之權限 (嚴格限制：僅限該趟出勤義消或警消承辦人)
function canEditDispatch(d) {
  if (!d) return false;
  if (!isLoggedIn()) return false;
  if (isSuperAdmin()) return true;
  const cur = getCurrentMember();
  if (!cur || cur.id === 'guest') return false;

  const authName = (currentAuthUser?.name || cur.name || '').trim();
  const authId = currentAuthUser?.memberId || cur.id;

  const hasName = Array.isArray(d.memberNames) && d.memberNames.some(name => (name || '').trim() === authName);
  const hasId = Array.isArray(d.memberIds) && d.memberIds.some(id => id === authId || id === cur.id);

  return hasName || hasId;
}

function initMemberSelector() {
  const select = document.getElementById('memberSelect');
  const modalMemberSelect = document.getElementById('inputDispatchMember');
  const adminAttSelect = document.getElementById('adminAttMemberSelect');
  const adminShiftSelect = document.getElementById('selectShiftMemberAdmin');
  
  if (select) select.innerHTML = '';
  if (modalMemberSelect) modalMemberSelect.innerHTML = '';
  if (adminAttSelect) adminAttSelect.innerHTML = '';
  if (adminShiftSelect) adminShiftSelect.innerHTML = '';

  const groups = {
    'admin': { label: '👑 分隊管理長官 / 承辦人', el: document.createElement('optgroup') },
    'cadre': { label: '🏛️ 分隊幹部', el: document.createElement('optgroup') },
    'squad1': { label: '🚒 第一小隊', el: document.createElement('optgroup') },
    'squad2': { label: '🚒 第二小隊', el: document.createElement('optgroup') },
    'squad3': { label: '🚒 第三小隊', el: document.createElement('optgroup') },
    'central': { label: '🚒 中區小隊', el: document.createElement('optgroup') },
    'retired': { label: '🚪 已退隊同仁 (離隊封存)', el: document.createElement('optgroup') }
  };

  Object.values(groups).forEach(g => {
    g.el.label = g.label;
  });

  members.forEach(m => {
    const isAdm = m.id === 'm0' || (m.role && (m.role.includes('警消') || m.role.includes('承辦人')));
    const isRetired = m.status === 'retired';
    const opt = document.createElement('option');
    opt.value = m.id;

    let rolePrefix = '';
    if (isAdm) rolePrefix = '👮‍♂️ ';
    else if (isRetired) rolePrefix = '🚪 ';
    else if (m.squadRole === '幹部') rolePrefix = '🎖️ ';
    else if (m.squadRole === '小隊長') rolePrefix = '⭐ ';
    else if (m.squadRole === '副小隊長') rolePrefix = '🌟 ';

    const roleDetail = m.squadRole && m.squadRole !== '隊員' ? ` (${m.squadRole}・${m.level})` : ` (${m.level})`;
    opt.textContent = `${rolePrefix}${m.name}${roleDetail}${isRetired ? ' [已退隊]' : ''}`;
    if (m.id === currentMemberId) opt.selected = true;

    if (isRetired) {
      groups.retired.el.appendChild(opt);
    } else if (isAdm) {
      groups.admin.el.appendChild(opt);
    } else if (m.squad === '分隊幹部') {
      groups.cadre.el.appendChild(opt);
    } else if (m.squad === '第一小隊') {
      groups.squad1.el.appendChild(opt);
    } else if (m.squad === '第二小隊') {
      groups.squad2.el.appendChild(opt);
    } else if (m.squad === '第三小隊') {
      groups.squad3.el.appendChild(opt);
    } else {
      groups.central.el.appendChild(opt);
    }

    // 只有在隊現職同仁，才會出現在出勤案件登記、後台排班指派與後台簽到選單中
    if (!isRetired) {
      if (modalMemberSelect) {
        const opt2 = document.createElement('option');
        opt2.value = m.name;
        opt2.textContent = `${m.name} (${m.level})`;
        modalMemberSelect.appendChild(opt2);
      }

      if (adminAttSelect) {
        const opt3 = document.createElement('option');
        opt3.value = m.id;
        opt3.textContent = `${m.name} (${m.squad || ''}・${m.squadRole || m.role}・${m.level})`;
        adminAttSelect.appendChild(opt3);
      }

      if (adminShiftSelect) {
        const opt4 = document.createElement('option');
        opt4.value = m.name;
        opt4.textContent = `${m.name} (${m.squad || ''}・${m.level})`;
        adminShiftSelect.appendChild(opt4);
      }
    }
  });

  if (select) {
    Object.values(groups).forEach(g => {
      if (g.el.children.length > 0) select.appendChild(g.el);
    });

    select.addEventListener('change', (e) => {
      currentMemberId = e.target.value;
      Store.set('currentMemberId', currentMemberId);
      updateAllViews();
      const cur = getCurrentMember();
      const isAdm = isSuperAdmin();
      showToast(isAdm ? `已切換至【分隊警消承辦人】(最高全域管理權限模式已啟動)` : `已切換至隊員：${cur.name}`, isAdm ? '👮‍♂️' : '👤');
    });
  }
}

function updateDutyHero() {
  const cur = getCurrentMember();
  const isAdm = isSuperAdmin();
  const badge = document.getElementById('currentMemberRoleBadge');
  const adminBanner = document.getElementById('adminModeBanner');
  const btnAdminAddAtt = document.getElementById('btnAdminAddAttendance');

  if (isAdm) {
    if (badge) {
      badge.className = 'role-badge super-admin';
      badge.textContent = `👮‍♂️ 警消承辦人 (最高全域管理權限)`;
    }
    if (adminBanner) adminBanner.style.display = 'flex';
    if (btnAdminAddAtt) btnAdminAddAtt.style.display = 'inline-flex';
  } else {
    if (badge) {
      badge.className = 'role-badge';
      badge.textContent = `⭐ ${cur.level}`;
    }
    if (adminBanner) adminBanner.style.display = 'none';
    if (btnAdminAddAtt) btnAdminAddAtt.style.display = 'none';
  }
  
  const statusPill = document.getElementById('dutyStatusPill');
  const statusText = document.getElementById('dutyStatusText');
  const btnIn = document.getElementById('btnPunchIn');
  const btnOut = document.getElementById('btnPunchOut');
  
  // 檢查當前隊員是否在隊協勤中
  const todayStr = getCurrentRocDate();
  const activeAttRecord = attendance.find(a => (a.memberId === cur.id || a.memberName === cur.name) && a.date === todayStr && (!a.signOut || a.signOut === '' || a.signOut === '—'));
  const isOnDuty = (activeDuty && activeDuty.memberId === cur.id) || !!activeAttRecord;

  if (isOnDuty) {
    const signInTime = (activeDuty && activeDuty.memberId === cur.id) ? activeDuty.timeStr : (activeAttRecord?.signIn || '');
    statusPill.className = 'status-pill';
    statusText.textContent = `協勤值勤中 (已於 ${signInTime} 簽到)`;
    if (btnIn) {
      btnIn.disabled = true;
      btnIn.classList.add('disabled');
      btnIn.style.opacity = '0.5';
    }
    if (btnOut) {
      btnOut.disabled = false;
      btnOut.classList.remove('disabled');
      btnOut.style.opacity = '1';
    }
  } else {
    statusPill.className = 'status-pill offline';
    statusText.textContent = `尚未簽到 (離隊)`;
    if (btnIn) {
      btnIn.disabled = false;
      btnIn.classList.remove('disabled');
      btnIn.style.opacity = '1';
    }
    if (btnOut) {
      btnOut.disabled = false; // 允許未在隊時點擊補登簽退
      btnOut.classList.remove('disabled');
      btnOut.style.opacity = '1';
    }
    const timerEl = document.getElementById('dutyTimerDisplay');
    if (timerEl) timerEl.textContent = '00:00:00';
  }
}

// 民國日期正規化 (補齊三位年與兩位月日，例: 115-10-9 -> 115-10-09)
function normalizeRocDateStr(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const clean = dateStr.trim().replace(/\//g, '-');
  const parts = clean.split('-');
  if (parts.length === 3) {
    const y = parts[0].padStart(3, '0');
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return clean;
}

// 本日狀況即時統計 (在隊義消名字、出勤趟數、並同步至警消幹部儀表板)
function updateTodayStatus() {
  const rawTodayStr = getCurrentRocDate();
  const todayStr = normalizeRocDateStr(rawTodayStr);
  const dateEl = document.getElementById('todayStatusDate');
  if (dateEl) dateEl.textContent = rawTodayStr;

  // 1. 本日出勤案件
  const todayDispatches = dispatches.filter(d => normalizeRocDateStr(d.date) === todayStr);
  const todayDispCount = todayDispatches.length;
  const dispEl = document.getElementById('todayDispatchCount');
  if (dispEl) dispEl.textContent = todayDispCount;

  // 2. 目前在隊義消名冊提取
  const onDutyMap = new Map();

  attendance.forEach(a => {
    if (normalizeRocDateStr(a.date) === todayStr && (!a.signOut || a.signOut === '—' || a.signOut === '')) {
      if (!onDutyMap.has(a.memberName)) {
        onDutyMap.set(a.memberName, {
          memberId: a.memberId,
          memberName: a.memberName,
          timeStr: a.signIn || ''
        });
      }
    }
  });

  if (activeDuty && activeDuty.memberName && normalizeRocDateStr(activeDuty.dateStr) === todayStr) {
    if (!onDutyMap.has(activeDuty.memberName)) {
      onDutyMap.set(activeDuty.memberName, {
        memberId: activeDuty.memberId,
        memberName: activeDuty.memberName,
        timeStr: activeDuty.timeStr || ''
      });
    }
  }

  const onDutyList = Array.from(onDutyMap.values());

  // (A) 更新分頁1 (協勤簽到頁面) 的在隊狀態
  const onDutyCountEl = document.getElementById('todayOnDutyCount');
  const badgeEl = document.getElementById('todayDutyCountBadge');
  if (onDutyCountEl) onDutyCountEl.textContent = onDutyList.length;
  if (badgeEl) {
    badgeEl.textContent = `在隊 ${onDutyList.length} 人`;
    badgeEl.style.background = onDutyList.length > 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)';
    badgeEl.style.color = onDutyList.length > 0 ? '#34d399' : 'var(--text-dim)';
  }

  // 計算每位同仁今日出勤趟數
  const memberDispCountMap = {};
  todayDispatches.forEach(d => {
    if (Array.isArray(d.memberNames)) {
      d.memberNames.forEach(name => {
        memberDispCountMap[name] = (memberDispCountMap[name] || 0) + 1;
      });
    } else if (Array.isArray(d.members)) {
      d.members.forEach(name => {
        memberDispCountMap[name] = (memberDispCountMap[name] || 0) + 1;
      });
    } else if (d.memberName) {
      memberDispCountMap[d.memberName] = (memberDispCountMap[d.memberName] || 0) + 1;
    }
  });

  // 渲染分頁1 在隊名單與出勤趟數
  const listEl = document.getElementById('todayOnDutyMemberList');
  if (listEl) {
    if (onDutyList.length === 0) {
      listEl.innerHTML = `
        <div style="font-size: 0.82rem; color: var(--text-dim); padding: 0.2rem 0;">
          🕊️ 目前尚無同仁在隊待命 (點擊左側「簽到」即可到隊)
        </div>
      `;
    } else {
      listEl.innerHTML = onDutyList.map(item => {
        const dCount = memberDispCountMap[item.memberName] || 0;
        return `
          <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); color: #f8fafc; padding: 0.35rem 0.75rem; border-radius: 99px; font-size: 0.84rem; display: inline-flex; align-items: center; gap: 0.45rem;">
            <span style="width: 7px; height: 7px; background: #10b981; border-radius: 50%; box-shadow: 0 0 6px #10b981;"></span>
            <strong style="color: #ffffff;">${item.memberName}</strong>
            <span style="font-size: 0.72rem; color: #fbbf24; background: rgba(0,0,0,0.35); padding: 1px 7px; border-radius: 99px; font-weight: 600;">
              出勤 ${dCount} 趟
            </span>
          </div>
        `;
      }).join('');
    }
  }

  const subtextEl = document.getElementById('todayDispatchSubtext');
  if (subtextEl) {
    subtextEl.textContent = todayDispCount > 0 ? `本日累計出勤 ${todayDispCount} 趟` : '本日尚無救護出勤案件';
  }

  // (B) 同步更新分頁5 (警消長官專區 / 幹部儀表板) 即時在隊動態看板
  const dashCountEl = document.getElementById('dashKpiLiveDutyCount');
  const dashPillEl = document.getElementById('dashLiveDutyPill');
  const dashSubtextEl = document.getElementById('dashLiveDutySubtext');
  const dashMemberListEl = document.getElementById('dashLiveDutyMemberList');

  if (dashCountEl) dashCountEl.textContent = onDutyList.length;
  if (dashPillEl) {
    dashPillEl.textContent = onDutyList.length > 0 ? `🟢 即時在隊 ${onDutyList.length} 人` : '⚪ 暫無同仁在隊';
    dashPillEl.style.background = onDutyList.length > 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)';
    dashPillEl.style.color = onDutyList.length > 0 ? '#34d399' : 'var(--text-dim)';
    dashPillEl.style.borderColor = onDutyList.length > 0 ? '#10b981' : 'var(--border-subtle)';
  }
  if (dashSubtextEl) {
    dashSubtextEl.textContent = `今日累計出勤 ${todayDispCount} 趟 ｜ 掌握博館分隊現場即時執勤戰力`;
  }
  if (dashMemberListEl) {
    if (onDutyList.length === 0) {
      dashMemberListEl.innerHTML = `
        <div style="font-size: 0.85rem; color: var(--text-dim); padding: 0.5rem 0;">
          🕊️ 目前分隊暫無同仁簽到待命中 (同仁手機簽到後將零延遲即時呈現於此)
        </div>
      `;
    } else {
      dashMemberListEl.innerHTML = onDutyList.map(item => {
        const dCount = memberDispCountMap[item.memberName] || 0;
        return `
          <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); color: #f8fafc; padding: 0.4rem 0.85rem; border-radius: 99px; font-size: 0.86rem; display: inline-flex; align-items: center; gap: 0.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
            <span style="width: 8px; height: 8px; background: #10b981; border-radius: 50%; box-shadow: 0 0 8px #10b981;"></span>
            <strong style="color: #ffffff; font-size: 0.92rem;">${item.memberName}</strong>
            ${item.timeStr ? `<span style="font-size: 0.74rem; color: #38bdf8;">📍 ${item.timeStr} 到隊</span>` : ''}
            <span style="font-size: 0.72rem; color: #fbbf24; background: rgba(0,0,0,0.35); padding: 1px 7px; border-radius: 99px; font-weight: 600;">
              出勤 ${dCount} 趟
            </span>
          </div>
        `;
      }).join('');
    }
  }
}

function updatePersonalSummary() {
  updateTodayStatus();
}

// 隊上近期簽到列表
function renderRecentAttendance() {
  const tbody = document.getElementById('recentAttendanceTbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const isAdm = isSuperAdmin();
  const thAdminAtt = document.getElementById('thAdminAttAction');
  if (thAdminAtt) thAdminAtt.style.display = isAdm ? 'table-cell' : 'none';
  const btnAdminAdd = document.getElementById('btnAdminAddAttendance');
  if (btnAdminAdd) btnAdminAdd.style.display = isAdm ? 'inline-flex' : 'none';

  // 若當前有隊員在隊協勤中，置頂展示綠燈動態
  if (activeDuty) {
    const activeTr = document.createElement('tr');
    activeTr.style.background = 'rgba(16, 185, 129, 0.12)';
    activeTr.style.borderLeft = '4px solid #10b981';
    activeTr.innerHTML = `
      <td><strong>${activeDuty.dateStr}</strong></td>
      <td><span style="color: #38bdf8; font-weight: 700;">${activeDuty.memberName}</span></td>
      <td><span style="color: #34d399; font-weight: 700;">📍 ${activeDuty.timeStr}</span></td>
      <td><span style="color: #10b981; font-weight: 700;">🟢 在隊待命中...</span></td>
      <td><span id="liveDutyHoursCell" style="font-weight: 700; color: #fbbf24;">計算中...</span></td>
      <td>—</td>
      <td style="color: var(--text-muted); font-size: 0.8rem;">${activeDuty.isBackfilled ? `補登到隊 (${activeDuty.backfillReason})` : '現場手機簽到'}</td>
      <td><span style="background: rgba(16,185,129,0.25); color: #34d399; font-size: 0.75rem; padding: 2px 8px; border-radius: 99px; font-weight: 700;">值勤中</span></td>
      ${isAdm ? '<td><span style="font-size: 0.75rem; color: #34d399;">協勤進行中</span></td>' : ''}
    `;
    tbody.appendChild(activeTr);
  }

  const list = [...attendance].slice(-8).reverse();
  list.forEach(att => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${att.date}</strong></td>
      <td><span style="color: #38bdf8; font-weight: 600;">${att.memberName}</span></td>
      <td>${att.signIn}</td>
      <td>${att.signOut || '<span style="color: #10b981;">協勤中...</span>'}</td>
      <td><span style="font-weight: 700; color: #fbbf24;">${att.hours ? att.hours + ' hr' : '-'}</span></td>
      <td>${att.dispatches} 趟</td>
      <td style="color: var(--text-muted); font-size: 0.8rem;">${att.note || '救護協勤'}</td>
      <td><span style="background: rgba(16,185,129,0.15); color: #34d399; font-size: 0.75rem; padding: 2px 8px; border-radius: 99px;">已核可</span></td>
      ${isAdm ? `
        <td>
          <div style="display: flex; gap: 4px;">
            <button class="btn-admin-edit btn-admin-edit-att" data-id="${att.id}">✏️ 編輯</button>
            <button class="btn-admin-delete btn-admin-delete-att" data-id="${att.id}">🗑️ 刪除</button>
          </div>
        </td>
      ` : ''}
    `;
    tbody.appendChild(tr);
  });

  if (isAdm) {
    tbody.querySelectorAll('.btn-admin-edit-att').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        openAdminEditAttendanceModal(id);
      });
    });
    tbody.querySelectorAll('.btn-admin-delete-att').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        deleteAttendanceRecord(id);
      });
    });
  }
}

// 救護出勤紀錄簿卡片列表
function renderDispatchList() {
  const container = document.getElementById('dispatchCardsList');
  const search = document.getElementById('searchDispatchInput').value.toLowerCase().trim();
  const filterVehicle = document.getElementById('filterVehicleSelect').value;
  const filterTag = document.getElementById('filterTagSelect').value;

  container.innerHTML = '';

  const isAdm = isSuperAdmin();

  const filtered = dispatches.filter(d => {
    if (filterVehicle !== 'ALL' && d.vehicle !== filterVehicle) return false;
    if (filterTag === 'ROSC' && (!d.isSpecial || !d.specialTag.includes('ROSC'))) return false;
    if (filterTag === 'ECG' && !d.treatments.includes('12導程心電圖')) return false;
    if (filterTag === 'CPR' && !d.treatments.includes('CPR')) return false;
    if (filterTag === 'IV' && !d.treatments.includes('靜脈注射')) return false;
    if (filterTag === 'IDLE' && !d.isIdle) return false;

    if (search) {
      const match = 
        d.caseNo.toLowerCase().includes(search) ||
        d.location.toLowerCase().includes(search) ||
        d.memberNames.some(n => n.toLowerCase().includes(search)) ||
        d.treatments.some(t => t.toLowerCase().includes(search)) ||
        (d.chiefComplaint && d.chiefComplaint.toLowerCase().includes(search));
      if (!match) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 3rem;">沒有符合條件的救護出勤紀錄</div>`;
    return;
  }

  filtered.forEach(d => {
    const card = document.createElement('div');
    card.className = 'dispatch-card';
    const is9192 = d.vehicle && d.vehicle.includes('91') && d.vehicle.includes('92');
    const vehicleClass = is9192 ? 'v91-92' : (d.vehicle.includes('91') ? 'v91' : (d.vehicle.includes('92') ? 'v92' : 'v-ems'));

    const tagsHtml = d.treatments.map(t => {
      const isSpecial = ['CPR', 'AED', '12導程心電圖', '靜脈注射'].includes(t);
      return `<span class="treatment-tag ${isSpecial ? 'highlight' : ''}">${t}</span>`;
    }).join('');

    const isNoHosp = !d.hospital || d.hospital === '無' || d.isIdle || (d.resultType && (d.resultType.includes('空跑') || d.resultType === '拒送'));
    const hospDisplay = isNoHosp ? '<span style="color: var(--text-muted);">無 (未送醫)</span>' : d.hospital;
    const patCount = (d.patientCount !== undefined && d.patientCount !== null) ? d.patientCount : (d.isIdle ? 0 : 1);

    const canEdit = canEditDispatch(d);

    card.innerHTML = `
      <div class="dispatch-header">
        <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
          <span class="case-id-tag">${d.caseNo}</span>
          <span class="vehicle-pill ${vehicleClass}">${d.vehicle}</span>
          <span style="font-weight: 600; font-size: 0.95rem;">${d.resultType}</span>
          ${d.specialTag ? `<span style="background: rgba(245,158,11,0.2); color: #fbbf24; border: 1px solid rgba(245,158,11,0.4); font-size: 0.75rem; padding: 2px 8px; border-radius: 99px; font-weight: 700;">${d.specialTag}</span>` : ''}
          <div style="display: inline-flex; gap: 4px; margin-left: auto;">
            ${canEdit ? `
              <button class="btn-admin-edit btn-admin-edit-disp" data-id="${d.id}" style="font-size: 0.75rem; padding: 3px 8px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 6px; cursor: pointer;" title="修改此出勤紀錄內容 (限本趟出勤義消或承辦人)">
                ✏️ 修改
              </button>
            ` : ''}
            ${isAdm ? `
              <button class="btn-admin-delete btn-admin-delete-disp" data-id="${d.id}" style="font-size: 0.75rem; padding: 3px 8px; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 6px; cursor: pointer;" title="刪除此出勤紀錄">
                🗑️ 刪除
              </button>
            ` : ''}
          </div>
        </div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">
          <span>📅 ${d.date}</span> ｜ <span>⏰ ${normalizeTimeStr(d.departureTime)} ~ ${normalizeTimeStr(d.returnTime)}</span>
        </div>
      </div>

      <div class="dispatch-meta">
        <div class="dispatch-meta-item">📍 <strong>地點：</strong> ${d.location}</div>
        <div class="dispatch-meta-item">🏥 <strong>送往：</strong> ${hospDisplay}</div>
        <div class="dispatch-meta-item">👥 <strong>送醫人數：</strong> <span style="color: #fbbf24; font-weight: 700;">${patCount} 人</span></div>
        <div class="dispatch-meta-item">👨‍🚒 <strong>出勤義消：</strong> <span style="color: #38bdf8; font-weight: 700;">${d.memberNames.join('、')}${d.memberNames.length > 1 ? ` (共${d.memberNames.length}人)` : ''}</span></div>
      </div>

      ${d.chiefComplaint ? `<div style="font-size: 0.85rem; color: #cbd5e1; margin-top: 0.25rem;">📝 <strong>傷病主訴：</strong>${d.chiefComplaint}</div>` : ''}

      <div class="treatment-tags">
        <strong style="font-size: 0.75rem; color: var(--text-dim); align-self: center;">現場處置：</strong>
        ${tagsHtml}
      </div>
    `;
    container.appendChild(card);
  });

  // 開放所有同仁點擊修改出勤紀錄 (防止手殘 Key 錯)
  container.querySelectorAll('.btn-admin-edit-disp').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      openEditDispatchModal(id);
    });
  });

  if (isAdm) {
    container.querySelectorAll('.btn-admin-delete-disp').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        deleteDispatchRecord(id);
      });
    });
  }
}

// 榮譽徽章牆渲染
function renderBadges() {
  if (!document.getElementById('badgesGrid')) return;
  const cur = getCurrentMember();
  document.getElementById('userBadgeAvatar').textContent = cur.avatar;
  document.getElementById('userBadgeName').textContent = cur.name;
  document.getElementById('userBadgeRole').textContent = `${cur.role} (${cur.level})`;
  document.getElementById('userBadgeJoined').textContent = `加入博館分隊：${cur.joined} ｜ 累計協勤 ${cur.totalHours} hr`;

  const container = document.getElementById('badgesGrid');
  container.innerHTML = '';

  let unlockedCount = 0;

  BADGE_DEFINITIONS.forEach(b => {
    const val = Number(cur[b.field]) || 0;
    const isUnlocked = val >= b.threshold;
    if (isUnlocked) unlockedCount++;

    const progressPercent = Math.min(100, Math.round((val / b.threshold) * 100));

    const card = document.createElement('div');
    card.className = `badge-card ${isUnlocked ? 'unlocked' : 'locked'}`;
    card.innerHTML = `
      <div class="badge-tag-status ${isUnlocked ? 'done' : 'pending'}">
        ${isUnlocked ? '★ 已榮譽解鎖' : '未達成'}
      </div>

      <div class="badge-header">
        <div class="badge-icon-box" style="${isUnlocked ? `border-color: ${b.color};` : ''}">
          ${b.icon}
        </div>
        <div class="badge-title-info">
          <h3>${b.name}</h3>
          <div class="badge-category">${b.category}</div>
        </div>
      </div>

      <div class="badge-desc">${b.description}</div>

      <div class="badge-progress-wrap">
        <div class="progress-info">
          <span style="color: var(--text-muted);">目前成就進度</span>
          <span style="font-weight: 700; color: ${isUnlocked ? '#fbbf24' : '#fff'};">${val} / ${b.threshold} ${b.unit}</span>
        </div>
        <div class="progress-track">
          <div class="progress-bar" style="width: ${progressPercent}%; ${isUnlocked ? `background: linear-gradient(90deg, ${b.color}, #f59e0b);` : ''}"></div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  document.getElementById('userBadgeUnlockedCount').textContent = `${unlockedCount} / ${BADGE_DEFINITIONS.length}`;
}

// ==========================================
// 4. 視覺化排班月曆與清單管理 (Visual Calendar)
// ==========================================
let calFilterVacantOnly = false;
let calCurrentMonth = 10;
let calCurrentYear = 115;

function getDaysInRocMonth(rocYear, month) {
  const gregYear = rocYear + 1911;
  return new Date(gregYear, month, 0).getDate();
}

function getRocDateWeekday(rocYear, month, day) {
  const gregYear = rocYear + 1911;
  const d = new Date(gregYear, month - 1, day);
  return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
}

function populateShiftDatesDropdown() {
  const select = document.getElementById('inputShiftDate');
  if (!select) return;
  select.innerHTML = '';
  const daysInMonth = getDaysInRocMonth(calCurrentYear, calCurrentMonth);
  const monthStr = String(calCurrentMonth).padStart(2, '0');

  const lbl = document.getElementById('labelShiftDateMonth');
  if (lbl) {
    lbl.textContent = `協勤日期 (${calCurrentYear}年${calCurrentMonth}月)`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = String(d).padStart(2, '0');
    const w = getRocDateWeekday(calCurrentYear, calCurrentMonth, d);
    const isHoliday = (calCurrentMonth === 10 && d === 10) ? ' (國慶日 ⭐)' : '';
    const opt = document.createElement('option');
    opt.value = `${calCurrentYear}-${monthStr}-${dayStr}`;
    opt.textContent = `${calCurrentYear}-${monthStr}-${dayStr} (${w})${isHoliday}`;
    if (d === 1) opt.selected = true;
    select.appendChild(opt);
  }
}

function renderVisualCalendar() {
  const grid = document.getElementById('calendarGridContainer');
  if (!grid) return;
  grid.innerHTML = '';

  const curUser = getCurrentMember();
  const filterVehicle = document.getElementById('calFilterVehicle')?.value || 'ALL';
  const highlightMe = document.getElementById('calHighlightMe')?.checked ?? true;

  // 更新頂部標題
  const titleText = document.getElementById('calMonthTitleText');
  if (titleText) {
    titleText.textContent = `民國 ${calCurrentYear} 年 ${calCurrentMonth} 月`;
  }
  const natTag = document.getElementById('calNationalDayTag');
  if (natTag) {
    natTag.style.display = (calCurrentMonth === 10) ? 'inline-block' : 'none';
  }

  // 1. 生成 7 天星期標題
  const weekdays = [
    { name: '週日 (Sun)', isWeekend: true },
    { name: '週一 (Mon)', isWeekend: false },
    { name: '週二 (Tue)', isWeekend: false },
    { name: '週三 (Wed)', isWeekend: false },
    { name: '週四 (Thu)', isWeekend: false },
    { name: '週五 (Fri)', isWeekend: false },
    { name: '週六 (Sat)', isWeekend: true }
  ];

  weekdays.forEach(w => {
    const header = document.createElement('div');
    header.className = `calendar-weekday-header ${w.isWeekend ? 'weekend' : ''}`;
    header.textContent = w.name;
    grid.appendChild(header);
  });

  const gregYear = calCurrentYear + 1911;
  const firstDayWeekday = new Date(gregYear, calCurrentMonth - 1, 1).getDay(); // 0(Sun) ~ 6(Sat)
  const prevMonthDays = new Date(gregYear, calCurrentMonth - 1, 0).getDate();
  const daysInMonth = getDaysInRocMonth(calCurrentYear, calCurrentMonth);
  const monthStr = String(calCurrentMonth).padStart(2, '0');
  const monthPrefix = `${calCurrentYear}-${monthStr}-`;

  // 2. 前置上個月填充格
  for (let p = 0; p < firstDayWeekday; p++) {
    const padDay = prevMonthDays - firstDayWeekday + 1 + p;
    const padCell = document.createElement('div');
    padCell.className = 'calendar-day-cell other-month';
    padCell.innerHTML = `<div class="calendar-day-header"><span class="calendar-day-num" style="opacity: 0.3;">${padDay}</span></div>`;
    grid.appendChild(padCell);
  }

  // 3. 生成 1~daysInMonth 日期儲存格
  let statTotal = 0;
  let statEms = 0;
  let statDesk = 0;
  let statVacant = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = String(d).padStart(2, '0');
    const dateKey = `${monthPrefix}${dayStr}`;
    const dObj = new Date(gregYear, calCurrentMonth - 1, d);
    const dayOfWeekIdx = dObj.getDay();
    const isWeekend = dayOfWeekIdx === 0 || dayOfWeekIdx === 6;
    const isToday = (calCurrentYear === 115 && calCurrentMonth === 10 && d === 7); // 展示基準日
    const isNationalDay = (calCurrentMonth === 10 && d === 10);

    // 取得當天所有班次（僅納入實際預約同仁，不留缺額警示）
    let dayShifts = shifts.filter(s => s.memberName && s.status !== '缺協勤' && (s.date === dateKey || (calCurrentMonth === 10 && s.day === d && !s.date?.includes('-'))));

    // 統計全月數據 (未過濾前)
    dayShifts.forEach(s => {
      statTotal++;
      if (s.vehicle.includes('值班')) statDesk++;
      else statEms++;
    });

    // 依篩選條件過濾顯示
    let visibleShifts = dayShifts;
    if (filterVehicle !== 'ALL') {
      if (filterVehicle === '救護協勤') {
        visibleShifts = visibleShifts.filter(s => !s.vehicle.includes('值班'));
      } else if (filterVehicle === '值班台') {
        visibleShifts = visibleShifts.filter(s => s.vehicle.includes('值班'));
      } else {
        visibleShifts = visibleShifts.filter(s => s.vehicle === filterVehicle);
      }
    }

    const hasMyShift = highlightMe && dayShifts.some(s => s.memberName === curUser.name);

    const cell = document.createElement('div');
    cell.className = `calendar-day-cell ${isWeekend ? 'is-weekend' : ''} ${isToday ? 'is-today' : ''} ${hasMyShift ? 'has-my-shift' : ''}`;
    cell.setAttribute('data-day', d);

    // 標頭區
    let badgeHtml = '';
    if (isNationalDay) {
      badgeHtml += `<span class="cal-special-tag">🇹🇼 雙十國慶</span>`;
    } else if (isToday) {
      badgeHtml += `<span class="cal-special-tag" style="background: rgba(16,185,129,0.2); color: #34d399; border-color: rgba(16,185,129,0.4);">🟢 今日</span>`;
    }

    // 班次晶片區 (最多直接展示 3 條，其餘 +N，不留缺額警示)
    let chipsHtml = '';
    const maxChips = 3;
    visibleShifts.slice(0, maxChips).forEach(s => {
      const isMine = s.memberName === curUser.name;
      const isDesk = s.vehicle.includes('值班');
      const chipClass = isDesk ? 'chip-desk' : 'chip-ems';
      const vLabel = isDesk ? (s.vehicle.includes('補定訓') ? '補定訓' : '值班') : '救護待命';
      const text = `${vLabel} ${s.memberName} ${s.period}`;
      
      chipsHtml += `
        <div class="cal-shift-chip ${chipClass} ${isMine ? 'is-mine' : ''}" title="${vLabel} ${s.period} ${s.memberName}">
          ${text}
        </div>
      `;
    });

    if (visibleShifts.length > maxChips) {
      chipsHtml += `<div class="cal-more-shifts-tag">+${visibleShifts.length - maxChips} 班...</div>`;
    } else if (visibleShifts.length === 0 && dayShifts.length > 0 && calFilterVacantOnly) {
      chipsHtml += `<div style="font-size: 0.7rem; color: var(--text-dim); margin-top: 4px;">無缺額班次</div>`;
    }

    // 當日站位席次統計 (先填先站位燈號)
    const activeEmsCount = dayShifts.filter(s => !s.vehicle.includes('值班') && s.memberName && s.status !== '缺協勤').length;
    const activeDeskCount = dayShifts.filter(s => s.vehicle.includes('值班') && s.memberName && s.status !== '缺協勤').length;
    const occSummaryHtml = `
      <div class="cal-occupancy-summary">
        <span class="cal-occ-badge ems ${activeEmsCount >= 4 ? 'full' : ''}" title="協勤救護：${activeEmsCount}/4 位">🚑 救護 ${activeEmsCount}/4${activeEmsCount >= 4 ? '滿' : ''}</span>
        <span class="cal-occ-badge desk ${activeDeskCount >= 1 ? 'full' : ''}" title="協勤值班：${activeDeskCount}/1 位">🏢 值班 ${activeDeskCount}/1${activeDeskCount >= 1 ? '滿' : ''}</span>
      </div>
    `;

    cell.innerHTML = `
      <div class="calendar-day-header">
        <span class="calendar-day-num">${d}</span>
        <div style="display: flex; gap: 4px;">${badgeHtml}</div>
      </div>
      ${occSummaryHtml}
      <div class="calendar-shifts-box">
        ${chipsHtml}
      </div>
    `;

    // 點擊開啟單日詳情抽屜
    cell.addEventListener('click', () => {
      openDayDetailModal(d);
    });

    grid.appendChild(cell);
  }

  // 4. 更新上方資訊條
  document.getElementById('calStatTotal').textContent = `${statTotal} 班`;
  if (document.getElementById('calStatEms')) document.getElementById('calStatEms').textContent = `${statEms} 班`;
  if (document.getElementById('calStatDesk')) document.getElementById('calStatDesk').textContent = `${statDesk} 班`;
  document.getElementById('calStatVacant').textContent = `${statVacant} 班`;
}

// ==========================================
// 4.1 協勤排班四大鐵律與違規管制核心邏輯
// ==========================================
const CURRENT_SYSTEM_DATE = '115-10-07';

// 取得特定隊員未完成/未來的預約班次數量 (>= CURRENT_SYSTEM_DATE)
function getMemberFutureShifts(memberName) {
  return shifts.filter(s => s.memberName === memberName && s.date >= CURRENT_SYSTEM_DATE && s.status !== '缺席');
}

// 全形轉換與時間格式清洗工具（防呆支援全形數字、全形冒號、小數點、各種連接符）
function cleanFlexibleTimeStr(s) {
  if (!s) return '';
  return String(s)
    .trim()
    .replace(/\s+/g, '')
    .replace(/[\uFF10-\uFF19]/g, m => String.fromCharCode(m.charCodeAt(0) - 0xFEE0))
    .replace(/[：點点]/g, ':')
    .replace(/[.。]/g, ':')
    .replace(/[－—–～~至到]/g, '-');
}

// 智慧彈性時間解析器：支援手動輸入如 "09-15", "9-15", "09:00-15:00", "09:30-15:00", "09~15", "0900-1500" 等
function parseTimePeriod(periodStr) {
  if (!periodStr || typeof periodStr !== 'string') return { startMin: 0, endMin: 0, valid: false, formatted: '' };
  const raw = cleanFlexibleTimeStr(periodStr);
  const parts = raw.split('-');
  if (parts.length !== 2) return { startMin: 0, endMin: 0, valid: false, formatted: '' };

  function parsePart(p) {
    if (!p) return null;
    const s = cleanFlexibleTimeStr(p);
    // 包含冒號格式，例如 "09:30", "9:00"
    if (s.includes(':')) {
      const [h, m] = s.split(':').map(Number);
      if (isNaN(h)) return null;
      return (h || 0) * 60 + (m || 0);
    }
    // 4位純數字格式，例如 "0930", "1500"
    if (/^\d{4}$/.test(s)) {
      const h = Number(s.slice(0, 2));
      const m = Number(s.slice(2, 4));
      return h * 60 + m;
    }
    // 3位純數字格式，例如 "930" -> 09:30
    if (/^\d{3}$/.test(s)) {
      const h = Number(s.slice(0, 1));
      const m = Number(s.slice(1, 3));
      return h * 60 + m;
    }
    // 1~2位純數字格式（常見手動簡寫），例如 "9", "09", "15", "22"
    if (/^\d{1,2}$/.test(s)) {
      const h = Number(s);
      return h * 60;
    }
    return null;
  }

  const startMin = parsePart(parts[0]);
  const endMin = parsePart(parts[1]);

  if (startMin === null || endMin === null || isNaN(startMin) || isNaN(endMin) || endMin <= startMin) {
    return { startMin: 0, endMin: 0, valid: false, formatted: '' };
  }

  const sh = String(Math.floor(startMin / 60)).padStart(2, '0');
  const sm = String(startMin % 60).padStart(2, '0');
  const eh = String(Math.floor(endMin / 60)).padStart(2, '0');
  const em = String(endMin % 60).padStart(2, '0');
  const formatted = `${sh}:${sm}-${eh}:${em}`;

  return { startMin, endMin, valid: true, formatted };
}

// 檢查時段是否嚴格在分隊規定 07:00 ~ 23:00 之間 (420 ~ 1380 分鐘)
function isWithinAllowedHours(startMin, endMin) {
  const minAllowed = 7 * 60;   // 07:00
  const maxAllowed = 23 * 60;  // 23:00
  return startMin >= minAllowed && endMin <= maxAllowed;
}

// 判斷兩時段是否有時間重疊 (交集)
function isTimeOverlap(p1, p2) {
  const t1 = parseTimePeriod(p1);
  const t2 = parseTimePeriod(p2);
  if (!t1.valid || !t2.valid) return false;
  return Math.max(t1.startMin, t2.startMin) < Math.min(t1.endMin, t2.endMin);
}

// 計算指定日期與彈性時段的容量與尖峰站位人數 (協勤值班限 1 位、協勤救護限 4 位)
function getSlotCapacityStatus(date, period, ignoreShiftId = null) {
  const reqTime = parseTimePeriod(period);
  const sameDayShifts = shifts.filter(s => s.date === date && s.id !== ignoreShiftId && s.memberName && s.status !== '缺席' && s.status !== '缺協勤');

  if (!reqTime.valid) {
    return {
      overlappingShifts: [],
      emsOccupants: [],
      deskOccupants: [],
      peakEmsConcurrency: 0,
      peakDeskConcurrency: 0,
      emsCapacity: 4,
      deskCapacity: 1,
      emsAvailable: 4,
      deskAvailable: 1,
      emsFull: false,
      deskFull: false,
      bottleneckEmsPeriod: null,
      bottleneckDeskPeriod: null
    };
  }

  // 與請求區間有任何重疊的既有班次
  const overlappingShifts = sameDayShifts.filter(s => isTimeOverlap(s.period, period));
  const emsOccupants = overlappingShifts.filter(s => !s.vehicle.includes('值班'));
  const deskOccupants = overlappingShifts.filter(s => s.vehicle.includes('值班') || (s.shiftType && s.shiftType.includes('值班')) || (s.vehicle && s.vehicle.includes('補定訓')));

  // 彈性時段每 15 分鐘精準取樣，檢驗區間內的最大同仁並發數量 (Peak Concurrency)
  let peakEmsConcurrency = 0;
  let peakDeskConcurrency = 0;
  let bottleneckEmsPeriod = null;
  let bottleneckDeskPeriod = null;

  for (let m = reqTime.startMin; m < reqTime.endMin; m += 15) {
    const activeEms = emsOccupants.filter(s => {
      const t = parseTimePeriod(s.period);
      return t.valid && t.startMin <= m && m < t.endMin;
    });
    if (activeEms.length > peakEmsConcurrency) {
      peakEmsConcurrency = activeEms.length;
      const sh = String(Math.floor(m / 60)).padStart(2, '0');
      const sm = String(m % 60).padStart(2, '0');
      const eh = String(Math.floor((m + 15) / 60)).padStart(2, '0');
      const em = String((m + 15) % 60).padStart(2, '0');
      bottleneckEmsPeriod = `${sh}:${sm}-${eh}:${em}`;
    }

    const activeDesk = deskOccupants.filter(s => {
      const t = parseTimePeriod(s.period);
      return t.valid && t.startMin <= m && m < t.endMin;
    });
    if (activeDesk.length > peakDeskConcurrency) {
      peakDeskConcurrency = activeDesk.length;
      const sh = String(Math.floor(m / 60)).padStart(2, '0');
      const sm = String(m % 60).padStart(2, '0');
      const eh = String(Math.floor((m + 15) / 60)).padStart(2, '0');
      const em = String((m + 15) % 60).padStart(2, '0');
      bottleneckDeskPeriod = `${sh}:${sm}-${eh}:${em}`;
    }
  }

  return {
    overlappingShifts,
    emsOccupants,
    deskOccupants,
    peakEmsConcurrency,
    peakDeskConcurrency,
    emsCapacity: 4,
    deskCapacity: 1,
    emsAvailable: Math.max(0, 4 - peakEmsConcurrency),
    deskAvailable: Math.max(0, 1 - peakDeskConcurrency),
    emsFull: peakEmsConcurrency >= 4,
    deskFull: peakDeskConcurrency >= 1,
    bottleneckEmsPeriod,
    bottleneckDeskPeriod
  };
}

// 驗證預約規則
// 返回 { ok: boolean, reason: string }
function validateShiftBooking(targetMember, date, vehicle, period, shiftType, ignoreShiftId = null, isOfficerOverride = false) {
  const isAdm = isSuperAdmin();

  // 1. 服勤時間檢查 (07:00 ~ 23:00)
  const timeInfo = parseTimePeriod(period);
  if (!timeInfo.valid || (!isWithinAllowedHours(timeInfo.startMin, timeInfo.endMin) && !isAdm)) {
    return { 
      ok: false, 
      reason: '【服勤時間不合規範】\n依分隊協勤規定：可服勤時間僅限 07:00 至 23:00 之間！夜間 23:00 後至清晨 07:00 前不開放協勤填寫。' 
    };
  }

  // 2. 管制期檢查 (階段二處分鎖定) - 警消最高管理者與幹部代填可豁免
  if (targetMember.isRestricted && !isOfficerOverride && !isAdm) {
    return {
      ok: false,
      reason: `⛔【處分管制中・禁止自行填班】\n隊員：${targetMember.name}\n管制期限：至 ${targetMember.restrictionUntil || '115-12-07'} 止（自刪除日起2個月）\n\n處分原因：超過三班且屬故意累犯，依規定於管制期內「無法自行填班，需透過小隊幹部填寫班表」！\n請直接洽詢分隊幹部協助填寫。`
    };
  }

  // 3. 每人預約上限最多 3 班 (含跨月) - 警消最高管理者與幹部代填可豁免
  const currentFuture = getMemberFutureShifts(targetMember.name).filter(s => s.id !== ignoreShiftId);
  if (currentFuture.length >= 3 && !isOfficerOverride && !isAdm) {
    return {
      ok: false,
      reason: `⚠️【預約額度已達上限】\n每位同仁每次預約上限最多 3 班（含跨月）！\n您目前已有 ${currentFuture.length} 班未協勤班次：\n${currentFuture.map(s => `• ${s.date} (${s.vehicle.includes('值班') ? s.vehicle : '救護協勤'} ${s.period})`).join('\n')}\n\n需待協勤完畢一班後，方可再往後填寫一班！遇突發狀況可隨時取消預定以釋出額度。`
    };
  }

  // 4. 補定訓特定檢驗規則
  const isMakeup = vehicle.includes('補定訓') || shiftType.includes('補定訓');
  if (isMakeup) {
    if (targetMember.makeupTrainingStatus === 'cancelled_absent' && !isAdm) {
      return {
        ok: false,
        reason: '⛔【不得再補值班】\n依分隊值班注意事項第 2 點規定：補定訓如已登記於值班欄位，臨時取消視為「缺席定訓」，亦不可再次補值班！'
      };
    }
    const durationHours = (timeInfo.endMin - timeInfo.startMin) / 60;
    if (durationHours !== 4 && !isAdm) {
      return {
        ok: false,
        reason: `【補定訓時數限制】\n依分隊值班注意事項第 2 點：補定訓改為值值班台，每次固定為 4 小時！您選擇的時段為 ${durationHours} 小時。`
      };
    }
  }

  // 5. 容量上限與「先填先站位」檢驗
  const cap = getSlotCapacityStatus(date, period, ignoreShiftId);

  // (A) 協勤救護：一個時段最多僅能 4 位，採先填先站位
  const isEms = !vehicle.includes('值班');
  if (isEms && !isAdm) {
    if (cap.emsFull) {
      return {
        ok: false,
        reason: `⚠️【協勤救護已額滿（上限 4 位）】\n依分隊排班規則：協勤救護一個時段最多僅能 4 位同仁待命隨車出勤（採先填先站位原則）！\n該時段已有 4 位同仁站位：\n${cap.emsOccupants.map(s => `• ${s.memberName} (${s.period})`).join('\n')}\n請選擇其他時段。若有同仁遇突發狀況取消，名額將即時釋出供遞補。`
      };
    }
  }

  // (B) 協勤值班：一個時段僅能 1 位，採先填先站位
  const isDesk = vehicle.includes('值班') || shiftType.includes('值班') || isMakeup;
  if (isDesk && !isAdm) {
    if (cap.deskFull) {
      return {
        ok: false,
        reason: `⚠️【協勤值班已額滿（上限 1 位）】\n依分隊排班規則：協勤值班一個時段僅能 1 位（採先填先站位原則）！\n該時段已有同仁值班：${cap.deskOccupants[0].memberName} (${cap.deskOccupants[0].period})。\n請選擇其他時段。`
      };
    }
  }

  // (C) 個人防重複檢驗：避免同仁自己同一時段排兩班
  const mySelfOverlap = cap.overlappingShifts.find(s => s.memberName === targetMember.name);
  if (mySelfOverlap) {
    const vName = mySelfOverlap.vehicle.includes('值班') ? mySelfOverlap.vehicle : '救護待命';
    return {
      ok: false,
      reason: `⚠️【時段衝突】\n您在該時段已有預約班次：${vName} (${mySelfOverlap.period})！\n請勿同一時段重複登記。`
    };
  }

  return { ok: true };
}

// 突發狀況取消排班彈窗控制
function openEmergencyCancelModal(shiftId) {
  const shift = shifts.find(s => s.id === shiftId);
  if (!shift) return;
  const cur = getCurrentMember();
  const isOfficer = isCurrentOfficer();
  const isAdm = isSuperAdmin();

  // 權限檢查：本人、幹部或警消承辦人
  if (shift.memberName !== cur.name && !isOfficer && !isAdm) {
    alert('非本人或分隊幹部/承辦人無法取消此班次！');
    return;
  }

  const isMakeup = (shift.vehicle && shift.vehicle.includes('補定訓')) || (shift.shiftType && shift.shiftType.includes('補定訓'));
  if (isMakeup) {
    const confirmMakeup = confirm(
      `⚠️【補定訓注意事項警語】\n依分隊規定：\n「補定訓改為值值班台，每次四小時，如已登記補定訓於值班欄位，臨時取消視為缺席定訓，亦不可再次補值班！」\n\n確定要取消 ${shift.date} 的補定訓班次嗎？`
    );
    if (!confirmMakeup) return;
    const targetMem = members.find(m => m.name === shift.memberName);
    if (targetMem) {
      targetMem.makeupTrainingStatus = 'cancelled_absent';
      Store.set('members', members);
    }
  }

  const modal = document.getElementById('modalCancelShift');
  if (!modal) {
    cancelShift(shiftId);
    return;
  }

  document.getElementById('cancelModalShiftId').value = shift.id;
  document.getElementById('cancelModalDate').textContent = shift.date;
  document.getElementById('cancelModalPeriod').textContent = shift.period;
  document.getElementById('cancelModalVehicle').textContent = shift.vehicle && shift.vehicle.includes('值班') ? `🏢 ${shift.vehicle}` : '🚑 協勤救護';
  document.getElementById('cancelModalMember').textContent = shift.memberName || cur.name;
  document.getElementById('cancelReasonNote').value = '';

  modal.classList.add('open');
}

// 執行突發狀況取消排班 (直接取消移除班次，不留下缺額警示)
function executeEmergencyCancel(shiftId, reasonCategory, reasonNote) {
  const shiftIndex = shifts.findIndex(s => s.id === shiftId);
  if (shiftIndex === -1) return;
  const shift = shifts[shiftIndex];
  const prevMember = shift.memberName;

  const isMakeup = (shift.vehicle && shift.vehicle.includes('補定訓')) || (shift.shiftType && shift.shiftType.includes('補定訓'));
  if (isMakeup) {
    const targetMem = members.find(m => m.name === shift.memberName);
    if (targetMem) {
      targetMem.makeupTrainingStatus = 'cancelled_absent';
      Store.set('members', members);
    }
  }

  // 寫入突發狀況取消記錄 (供紀錄備查)
  const newLog = {
    id: `can-${Date.now()}`,
    shiftId: shift.id,
    date: shift.date,
    period: shift.period,
    vehicle: shift.vehicle,
    memberName: prevMember,
    reason: reasonCategory + (reasonNote ? ` (${reasonNote})` : ''),
    timestamp: `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`
  };
  cancellationLogs.unshift(newLog);
  if (cancellationLogs.length > 20) cancellationLogs.pop();
  Store.set('cancellation_logs', cancellationLogs);

  // 直接取消移除預約班次，不留下缺額警示
  const cancelledId = shift.id;
  shifts.splice(shiftIndex, 1);
  Store.set('shifts', shifts);
  deleteShiftFromSupabase(cancelledId);

  document.getElementById('modalCancelShift')?.classList.remove('open');
  updateAllViews();

  // 若當日詳細視窗開啟中，重新載入
  const modalDay = document.getElementById('modalDayDetail');
  if (modalDay && modalDay.classList.contains('open')) {
    const day = Number(shift.date.split('-')[2]);
    openDayDetailModal(day);
  }

  showToast(`已成功取消 ${prevMember} 的預定班次！`, '✅');
  playFeedbackSound('success');
}

// 相容舊有取消按鈕直接呼叫
function cancelShift(shiftId) {
  openEmergencyCancelModal(shiftId);
}

// 一鍵「⚡ 先填先站位」
function claimSlotInstantly(date, period, category) {
  if (!isLoggedIn()) {
    showToast('請先登入義消同仁帳號方可預定排班！', '⚠️');
    document.getElementById('modalLogin')?.classList.add('open');
    return;
  }
  const cur = getCurrentMember();
  const vehicle = category === '值班' ? '值班台' : '救護協勤';
  const shiftType = category === '值班' ? '幹部值班' : '自排班';

  // 進行四大鐵律與容量法規檢驗
  const validation = validateShiftBooking(cur, date, vehicle, period, shiftType, null, false);
  if (!validation.ok) {
    alert(validation.reason);
    playFeedbackSound('alert');
    return;
  }

  // 尋找現成空缺班次（狀態為 '缺協勤'），若有則直接認領
  let vacantShift = shifts.find(s => s.date === date && s.period === period && (!s.memberName || s.status === '缺協勤') && (category === '值班' ? s.vehicle.includes('值班') : !s.vehicle.includes('值班')));

  if (vacantShift) {
    vacantShift.memberName = cur.name;
    vacantShift.status = '已排班';
    vacantShift.shiftType = shiftType;
    pushShiftToSupabase(vacantShift);
  } else {
    const dayNum = Number(date.split('-')[2]) || 1;
    const dateParts = date.split('-');
    const gregYear = Number(dateParts[0]) + 1911;
    const mIdx = Number(dateParts[1]) - 1;
    const dVal = Number(dateParts[2]);
    const weekdayName = ['日', '一', '二', '三', '四', '五', '六'][new Date(gregYear, mIdx, dVal).getDay()];

    const newShift = {
      id: `s-${Date.now()}`,
      date,
      day: dayNum,
      dayOfWeek: weekdayName,
      vehicle,
      period,
      memberName: cur.name,
      status: '已排班',
      shiftType,
      isMakeupTraining: false
    };
    shifts.push(newShift);
    pushShiftToSupabase(newShift);
  }

  Store.set('shifts', shifts);
  updateAllViews();
  const day = Number(date.split('-')[2]);
  openDayDetailModal(day);
  playFeedbackSound('success');
  showToast(`⚡ 先填先站位成功！您已成功預約 ${date} (${vehicle} ${period}) 席位！`, '🎉');
}

// 渲染席次釋出即時動態條
function renderReleasedFeed() {
  const feedBox = document.getElementById('releasedShiftsFeed');
  const feedContent = document.getElementById('releasedFeedContent');
  if (!feedBox || !feedContent) return;

  if (!cancellationLogs || cancellationLogs.length === 0) {
    feedBox.style.display = 'none';
    return;
  }

  const latest = cancellationLogs[0];
  const isDesk = latest.vehicle && latest.vehicle.includes('值班');
  const vLabel = isDesk ? '🏢 協勤值班' : '🚑 協勤救護';

  feedBox.style.display = 'flex';
  feedContent.innerHTML = `
    <span>[${latest.timestamp || '即時'}] 同仁 <strong>${latest.memberName}</strong> 遇突發狀況（${latest.reason}）釋出 <strong>${latest.date} (${vLabel} ${latest.period})</strong> 席位！</span>
    <button class="btn-quick-claim" data-date="${latest.date}">⚡ 立即前往先填先站位</button>
  `;

  feedContent.querySelector('.btn-quick-claim')?.addEventListener('click', () => {
    const day = Number(latest.date.split('-')[2]);
    openDayDetailModal(day);
  });
}

// 更新個人預約額度狀態列 (N / 3 班)
function updatePersonalQuotaUI() {
  const cur = getCurrentMember();
  const futureShifts = getMemberFutureShifts(cur.name);
  const count = futureShifts.length;
  const isRestricted = !!cur.isRestricted;

  const quotaAvatar = document.getElementById('userQuotaAvatar');
  const quotaName = document.getElementById('userQuotaName');
  const quotaStatusBadge = document.getElementById('userQuotaStatusBadge');
  const quotaCount = document.getElementById('userQuotaCount');
  const quotaRemain = document.getElementById('userQuotaRemain');
  const quotaProgressBar = document.getElementById('userQuotaProgressBar');
  const quotaDesc = document.getElementById('userQuotaDesc');

  if (quotaAvatar) quotaAvatar.textContent = cur.avatar || '👨‍🚒';
  if (quotaName) quotaName.textContent = cur.name;
  if (quotaCount) quotaCount.textContent = count;
  if (quotaRemain) quotaRemain.textContent = Math.max(0, 3 - count);

  const percent = Math.min(100, Math.round((count / 3) * 100));
  if (quotaProgressBar) {
    quotaProgressBar.style.width = `${percent}%`;
    if (isRestricted) {
      quotaProgressBar.style.background = '#ef4444';
    } else if (count >= 3) {
      quotaProgressBar.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)';
    } else {
      quotaProgressBar.style.background = 'linear-gradient(90deg, #10b981, #06b6d4)';
    }
  }

  if (quotaStatusBadge) {
    if (isRestricted) {
      quotaStatusBadge.textContent = `⛔ 管制中 (至 ${cur.restrictionUntil || '115-12-07'})`;
      quotaStatusBadge.style.background = 'rgba(239,68,68,0.25)';
      quotaStatusBadge.style.color = '#f87171';
      quotaStatusBadge.style.borderColor = '#ef4444';
    } else if (count >= 3) {
      quotaStatusBadge.textContent = '⚠️ 額度已滿 (3/3 班)';
      quotaStatusBadge.style.background = 'rgba(245,158,11,0.2)';
      quotaStatusBadge.style.color = '#fbbf24';
      quotaStatusBadge.style.borderColor = '#f59e0b';
    } else {
      quotaStatusBadge.textContent = `✅ 額度正常 (可再預約 ${3 - count} 班)`;
      quotaStatusBadge.style.background = 'rgba(16,185,129,0.2)';
      quotaStatusBadge.style.color = '#34d399';
      quotaStatusBadge.style.borderColor = '#10b981';
    }
  }

  if (quotaDesc) {
    if (isRestricted) {
      quotaDesc.innerHTML = `<span style="color: #f87171; font-weight: 600;">⛔ 處分管制中（至 ${cur.restrictionUntil || '115-12-07'} 止）：無法自行填班，需由小隊幹部代填。</span>`;
    } else if (count >= 3) {
      quotaDesc.innerHTML = `目前已預約：<strong style="color: #ef4444;">3 / 3 班 (已達上限)</strong> ｜ 需完成一班後方可再往後填寫`;
    } else {
      quotaDesc.innerHTML = `目前未完成預約：<strong style="color: #38bdf8;">${count}</strong> / 3 班 ｜ 尚可預約：<strong style="color: #34d399;">${3 - count}</strong> 班`;
    }
  }
}

// 小隊幹部專用審查與三階段違規管制操作
function renderOfficerAuditPanel() {
  const panel = document.getElementById('officerAuditPanel');
  if (!panel) return;

  const isOfficer = isCurrentOfficer();
  if (!isOfficer) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';

  const tbody = document.getElementById('officerAuditTbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  members.forEach(m => {
    const futureShifts = getMemberFutureShifts(m.name);
    const count = futureShifts.length;
    const isExceeded = count > 3;
    const isRestricted = !!m.isRestricted;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${m.name}</strong></td>
      <td>${m.role} (${m.level})</td>
      <td>
        <span style="font-size: 1.05rem; font-weight: 700; color: ${isExceeded ? '#ef4444' : (count === 3 ? '#f59e0b' : '#34d399')};">
          ${count}
        </span> / 3 班
      </td>
      <td>
        ${isRestricted 
          ? `<span style="background: rgba(239,68,68,0.2); color: #f87171; padding: 2px 8px; border-radius: 99px; font-size: 0.75rem; font-weight: 700;">⛔ 管制中</span>`
          : (isExceeded 
              ? `<span style="background: rgba(239,68,68,0.15); color: #ef4444; padding: 2px 8px; border-radius: 99px; font-size: 0.75rem; font-weight: 700;">⚠️ 違規超額</span>`
              : (count === 3 
                  ? `<span style="background: rgba(245,158,11,0.15); color: #fbbf24; padding: 2px 8px; border-radius: 99px; font-size: 0.75rem;">滿額</span>` 
                  : `<span style="background: rgba(16,185,129,0.15); color: #34d399; padding: 2px 8px; border-radius: 99px; font-size: 0.75rem;">正常</span>`))
        }
      </td>
      <td>
        <span style="font-size: 0.78rem; color: var(--text-muted);">
          ${isRestricted ? (m.restrictionUntil || '115-12-07 (2個月)') : '—'}
        </span>
      </td>
      <td>
        <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
          ${isExceeded ? `
            <button class="btn-secondary btn-officer-remind" data-member-name="${m.name}" style="font-size: 0.72rem; padding: 2px 6px; color: #fbbf24; border-color: rgba(245,158,11,0.4);">
              📢 階段一：提醒調整
            </button>
            <button class="btn-secondary btn-officer-penalize" data-member-id="${m.id}" style="font-size: 0.72rem; padding: 2px 6px; color: #f87171; border-color: rgba(239,68,68,0.5); background: rgba(239,68,68,0.1);">
              🔨 階段二：刪除並管制2月
            </button>
          ` : ''}
          ${isRestricted ? `
            <button class="btn-secondary btn-officer-unrestrict" data-member-id="${m.id}" style="font-size: 0.72rem; padding: 2px 6px; color: #38bdf8;">
              🔓 解除管制
            </button>
          ` : ''}
          <button class="btn-secondary btn-officer-proxy-book" data-member-name="${m.name}" style="font-size: 0.72rem; padding: 2px 6px;">
            📝 幹部代填班
          </button>
          <button class="btn-secondary btn-admin-edit-member-btn" data-member-id="${m.id}" style="font-size: 0.72rem; padding: 2px 6px; color: #fbbf24; border-color: rgba(245,158,11,0.4);">
            ✏️ 編輯隊員檔案
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 綁定幹部事件
  tbody.querySelectorAll('.btn-admin-edit-member-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-member-id');
      openAdminEditMemberModal(id);
    });
  });
  tbody.querySelectorAll('.btn-officer-remind').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-member-name');
      showToast(`【階段一：幹部提醒】已對隊員【${name}】發出提醒：預約超過三班，請當事人儘速自行於雲端調整刪除超額班次！`, '📢');
    });
  });

  tbody.querySelectorAll('.btn-officer-penalize').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-member-id');
      const mem = members.find(m => m.id === id);
      if (!mem) return;

      const confirmPenalty = confirm(
        `⚠️【階段二：小隊幹部強制處分確認】\n對象：${mem.name} (${mem.role})\n違規事由：超過三班且屬故意累犯。\n\n處分措施：\n1. 幹部逕行刪除其超過 3 班的部分（保留最早 3 班，名額重新釋出）。\n2. 自刪除日起 2 個月內（管制至 115-12-07 止），鎖定其自行填班權限，需透過小隊幹部代填。\n\n確定執行處分？`
      );
      if (!confirmPenalty) return;

      // 取得該員未來所有排班按日期排序
      const myFuture = shifts.filter(s => s.memberName === mem.name && s.date >= CURRENT_SYSTEM_DATE);
      myFuture.sort((a, b) => a.date.localeCompare(b.date));

      let deletedCount = 0;
      if (myFuture.length > 3) {
        const excess = myFuture.slice(3);
        const excessIds = new Set(excess.map(s => s.id));
        excess.forEach(s => {
          deletedCount++;
          deleteShiftFromSupabase(s.id);
        });
        shifts = shifts.filter(s => !excessIds.has(s.id));
        Store.set('shifts', shifts);
      }

      // 設定管制
      mem.isRestricted = true;
      mem.restrictionUntil = '115-12-07';
      mem.restrictionCount = (Number(mem.restrictionCount) || 0) + 1;

      Store.set('members', members);
      Store.set('shifts', shifts);

      updateAllViews();
      showToast(`【處分完成】已刪除 ${mem.name} 超額之 ${deletedCount} 班，並實施 2 個月填班管制（至 115-12-07）！`, '🔨');
      playFeedbackSound('alert');
    });
  });

  tbody.querySelectorAll('.btn-officer-unrestrict').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-member-id');
      const mem = members.find(m => m.id === id);
      if (!mem) return;
      mem.isRestricted = false;
      Store.set('members', members);
      updateAllViews();
      showToast(`已解除隊員【${mem.name}】的填班管制！`, '🔓');
    });
  });

  tbody.querySelectorAll('.btn-officer-proxy-book').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-member-name');
      const targetMem = members.find(m => m.name === name) || { name };
      const modal = document.getElementById('modalClaimShift');
      document.getElementById('inputShiftMemberName').value = name;
      if (window.updateModalQuotaPreview) window.updateModalQuotaPreview(targetMem);
      modal.setAttribute('data-officer-proxy', 'true');
      modal.classList.add('open');
      if (typeof updateFlexibleTimeInputs === 'function') updateFlexibleTimeInputs(true);
      showToast(`已進入【幹部代填模式】（代表隊員：${name} 填表）`, '👮');
    });
  });
}

// 點擊開啟單日排班詳細彈窗 (先填先站位席次看板 + 07:00~23:00 彈性時間軸)
function openDayDetailModal(day) {
  const modal = document.getElementById('modalDayDetail');
  const dayStr = String(day).padStart(2, '0');
  const monthStr = String(calCurrentMonth).padStart(2, '0');
  const dateKey = `${calCurrentYear}-${monthStr}-${dayStr}`;
  const weekday = getRocDateWeekday(calCurrentYear, calCurrentMonth, day);
  const curUser = getCurrentMember();
  const isOfficer = isCurrentOfficer();
  const isAdm = isSuperAdmin();

  document.getElementById('dayDetailTitle').textContent = `📅 ${calCurrentYear}年${monthStr}月${dayStr}日 (週${weekday}) 彈性協勤排班詳情`;
  document.getElementById('dayDetailSub').textContent = `博館分隊 救護待命與值班台 ｜ 自由填寫彈性時段（如 09-13、07-15、17-22）｜ 先填先站位`;

  // 1. 渲染全日 07:00 ~ 23:00 即時人力負載時間軸分佈條
  const timelineContainer = document.getElementById('dayTimelineContainer');
  const dayShifts = shifts.filter(s => s.date === dateKey || (calCurrentMonth === 10 && s.day === day && !s.date?.includes('-')));

  if (timelineContainer) {
    let slotsHtml = '';
    for (let h = 7; h < 23; h++) {
      const hStr = String(h).padStart(2, '0');
      const nextHStr = String(h + 1).padStart(2, '0');
      const startMin = h * 60;
      const endMin = (h + 1) * 60;
      
      // 計算該小時區間內在隊的救護與值班同仁
      const activeEms = dayShifts.filter(s => {
        if (s.vehicle && s.vehicle.includes('值班')) return false;
        if (!s.memberName || s.status === '缺席' || s.status === '缺協勤') return false;
        const tp = parseTimePeriod(s.period);
        return tp.valid && Math.max(tp.startMin, startMin) < Math.min(tp.endMin, endMin);
      });

      const activeDesk = dayShifts.filter(s => {
        if (!s.vehicle || !s.vehicle.includes('值班')) return false;
        if (!s.memberName || s.status === '缺席' || s.status === '缺協勤') return false;
        const tp = parseTimePeriod(s.period);
        return tp.valid && Math.max(tp.startMin, startMin) < Math.min(tp.endMin, endMin);
      });

      const emsCount = activeEms.length;
      const deskCount = activeDesk.length;
      const emsClass = emsCount >= 4 ? 'full' : (emsCount >= 2 ? 'half' : 'safe');
      const deskClass = deskCount >= 1 ? 'occupied' : '';

      slotsHtml += `
        <div class="timeline-hour-slot" title="${hStr}:00 - ${nextHStr}:00\n🚑 救護協勤：${emsCount}/4 位 (${activeEms.map(s => s.memberName).join('、') || '尚無'})\n🏢 值班台：${deskCount}/1 位 (${activeDesk.map(s => s.memberName).join('、') || '尚無'})\n點擊可直接登記此時段！" data-hour="${hStr}">
          <div class="th-label">${hStr}:00</div>
          <div class="th-ems ${emsClass}">🚑 ${emsCount}/4</div>
          <div class="th-desk ${deskClass}">${deskCount >= 1 ? '🏢 值班' : '🏢 空'}</div>
        </div>
      `;
    }

    timelineContainer.innerHTML = `
      <div style="background: rgba(15,23,42,0.7); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 0.75rem 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.45rem; flex-wrap: wrap; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-size: 1rem;">📊</span>
            <span style="font-size: 0.85rem; font-weight: 700; color: #fff;">07:00 ~ 23:00 即時人力負載時間軸</span>
            <span style="font-size: 0.72rem; color: var(--text-muted);">（滑鼠移入看人名，點擊時段可直達登記）</span>
          </div>
          <div style="display: flex; gap: 0.6rem; font-size: 0.72rem; align-items: center;">
            <span style="color: #34d399;">● 救護尚餘席次</span>
            <span style="color: #f87171;">● 救護滿席(4位)</span>
            <span style="color: #c084fc;">● 值班席(上限1位)</span>
          </div>
        </div>
        <div class="timeline-track-wrap">
          ${slotsHtml}
        </div>
      </div>
    `;

    // 點擊時間軸小時格子，直接帶入自訂時段並開啟彈窗
    timelineContainer.querySelectorAll('.timeline-hour-slot').forEach(slot => {
      slot.style.cursor = 'pointer';
      slot.addEventListener('click', () => {
        const startH = slot.getAttribute('data-hour');
        const endH = String(Math.min(23, Number(startH) + 4)).padStart(2, '0');
        modal.classList.remove('open');
        const selectDate = document.getElementById('inputShiftDate');
        if (selectDate) selectDate.value = dateKey;
        const curUser = getCurrentMember();
        document.getElementById('inputShiftMemberName').value = curUser.name;
        if (window.updateModalQuotaPreview) window.updateModalQuotaPreview(curUser);
        syncFlexiblePeriodInputs(`${startH}:00`, `${endH}:00`);
        document.getElementById('modalClaimShift')?.classList.add('open');
        updateClaimModalSlotMeter();
      });
    });
  }

  const container = document.getElementById('dayDetailShiftsList');
  container.innerHTML = '';

  // 2. 顯示「當日已登記彈性班次即時明細」
  const registeredShifts = dayShifts.filter(s => s.memberName && s.status !== '缺席' && s.status !== '缺協勤');
  if (registeredShifts.length > 0) {
    const regSection = document.createElement('div');
    regSection.style.cssText = 'background: rgba(30,41,59,0.5); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 0.85rem 1rem; margin-bottom: 0.75rem;';
    
    let regListHtml = '';
    registeredShifts.sort((a, b) => parseTimePeriod(a.period).startMin - parseTimePeriod(b.period).startMin).forEach(s => {
      const isMine = s.memberName === curUser.name;
      const memObj = members.find(m => m.name === s.memberName);
      const isDesk = s.vehicle && s.vehicle.includes('值班');
      const tInfo = parseTimePeriod(s.period);
      const durationHours = tInfo.valid ? ((tInfo.endMin - tInfo.startMin) / 60).toFixed(1) : '4.0';

      regListHtml += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.45rem 0.65rem; background: rgba(15,23,42,0.5); border: 1px solid ${isMine ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.06)'}; border-radius: 6px; margin-bottom: 0.35rem; flex-wrap: wrap; gap: 0.4rem;">
          <div style="display: flex; align-items: center; gap: 0.6rem;">
            <span style="font-size: 0.85rem;">${isDesk ? '🏢' : '🚑'}</span>
            <strong style="font-size: 0.88rem; color: #fff;">${memObj?.avatar || '👨‍🚒'} ${s.memberName}</strong>
            <span style="font-size: 0.72rem; color: ${isDesk ? '#c084fc' : '#38bdf8'}; font-weight: 600;">${isDesk ? '協勤值班' : '救護待命'}</span>
            <span style="font-size: 0.75rem; color: #fbbf24; background: rgba(245,158,11,0.15); padding: 1px 6px; border-radius: 4px; font-weight: 700;">⏱️ ${s.period} (${durationHours}h)</span>
            ${isMine ? '<span style="font-size: 0.68rem; background: #0284c7; color: #fff; padding: 1px 5px; border-radius: 3px;">您本人</span>' : ''}
          </div>
          <div>
            ${(isMine || isOfficer || isAdm) ? `
              <button class="btn-seat-cancel" data-shift-id="${s.id}" style="font-size: 0.72rem; padding: 3px 8px;">
                🚨 遇突發狀況取消預定
              </button>
            ` : '<span style="font-size: 0.7rem; color: var(--text-muted);">已站位確認</span>'}
          </div>
        </div>
      `;
    });

    regSection.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
        <span style="font-size: 0.82rem; font-weight: 700; color: #38bdf8;">📋 今日已站位同仁清單（共 ${registeredShifts.length} 位）</span>
        <span style="font-size: 0.72rem; color: var(--text-muted);">支援自訂彈性時段，遇突發狀況可隨時取消釋出</span>
      </div>
      ${regListHtml}
    `;
    container.appendChild(regSection);
  }

  // 3. 整理常用彈性時段站位卡片 (包含09-15, 09-13, 07-15, 17-22, 18-23等)
  const defaultPeriods = ['09:00-15:00', '09:00-13:00', '07:00-15:00', '17:00-22:00', '18:00-23:00', '14:00-18:00', '08:00-12:00'];
  const periodSet = new Set(defaultPeriods);
  dayShifts.forEach(s => {
    if (s.period) periodSet.add(s.period);
  });

  const sortedPeriods = Array.from(periodSet).sort((a, b) => {
    const tA = parseTimePeriod(a).startMin;
    const tB = parseTimePeriod(b).startMin;
    return tA - tB;
  });

  sortedPeriods.forEach(period => {
    const pInfo = parseTimePeriod(period);
    const durationHours = pInfo.valid ? ((pInfo.endMin - pInfo.startMin) / 60).toFixed(1) : '4.0';
    const cap = getSlotCapacityStatus(dateKey, period);

    const card = document.createElement('div');
    card.className = 'slot-group-card';

    // (A) 救護席位 (4席)
    let emsSeatsHtml = '';
    for (let i = 0; i < 4; i++) {
      const occ = cap.emsOccupants[i];
      if (occ) {
        const memObj = members.find(m => m.name === occ.memberName);
        const isMine = occ.memberName === curUser.name;
        emsSeatsHtml += `
          <div class="slot-seat-box occupied ${isMine ? 'is-mine' : ''}">
            <div>
              <span class="seat-num-badge">救護席位 ${i + 1}</span>
              <div class="seat-member-name">${memObj?.avatar || '👨‍🚒'} ${occ.memberName}</div>
              <div class="seat-member-role">${memObj?.level || 'EMT-2'} (${occ.shiftType})</div>
              ${isMine ? '<span class="seat-mine-tag">★ 您本人</span>' : ''}
            </div>
            ${(isMine || isOfficer || isAdm) ? `
              <button class="btn-seat-cancel" data-shift-id="${occ.id}">
                🚨 遇突發取消預定
              </button>
            ` : ''}
          </div>
        `;
      } else {
        emsSeatsHtml += `
          <div class="slot-seat-box vacant">
            <div>
              <span class="seat-num-badge">救護席位 ${i + 1}</span>
              <div style="font-weight: 700; font-size: 0.85rem; color: #34d399; margin: 4px 0;">🟢 開放站位</div>
              <div style="font-size: 0.7rem; color: var(--text-muted);">尚無同仁登記</div>
            </div>
            <button class="btn-seat-claim" data-date="${dateKey}" data-period="${period}" data-category="救護">
              ⚡ 先填先站位
            </button>
          </div>
        `;
      }
    }

    // (B) 值班席位 (1席)
    let deskSeatHtml = '';
    const deskOcc = cap.deskOccupants[0];
    if (deskOcc) {
      const memObj = members.find(m => m.name === deskOcc.memberName);
      const isMine = deskOcc.memberName === curUser.name;
      const isMakeup = (deskOcc.vehicle && deskOcc.vehicle.includes('補定訓')) || (deskOcc.shiftType && deskOcc.shiftType.includes('補定訓'));
      deskSeatHtml = `
        <div class="slot-seat-box occupied desk-occupied ${isMine ? 'is-mine' : ''}">
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; flex-wrap: wrap; gap: 0.5rem;">
            <div style="text-align: left;">
              <span class="seat-num-badge">值班台專屬席位 (上限 1 位)</span>
              <div class="seat-member-name">${memObj?.avatar || '🏢'} ${deskOcc.memberName} <span style="font-size: 0.78rem; color: #c084fc;">(${deskOcc.shiftType || '值班'})</span></div>
              <div class="seat-member-role">${memObj?.role || '隊員'} ｜ ${isMakeup ? '⚠️ 補定訓值班 (固定4小時)' : '常規值班台待命'}</div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              ${isMine ? '<span class="seat-mine-tag">★ 您本人</span>' : ''}
              ${(isMine || isOfficer || isAdm) ? `
                <button class="btn-seat-cancel" data-shift-id="${deskOcc.id}" style="width: auto; padding: 4px 10px;">
                  🚨 遇突發取消預定
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    } else {
      deskSeatHtml = `
        <div class="slot-seat-box vacant" style="min-height: auto; padding: 0.85rem 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; flex-wrap: wrap; gap: 0.5rem;">
            <div style="text-align: left;">
              <span class="seat-num-badge">值班台專屬席位 (上限 1 位)</span>
              <div style="font-weight: 700; font-size: 0.9rem; color: #34d399;">🟢 值班台空缺中・開放站位</div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">一個時段僅限 1 位（採先填先站位原則）</div>
            </div>
            <button class="btn-seat-claim" data-date="${dateKey}" data-period="${period}" data-category="值班" style="width: auto; padding: 5px 14px; font-size: 0.8rem;">
              ⚡ 先填先站位 (值班認領)
            </button>
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="slot-group-header">
        <div class="slot-period-tag">
          <span>⏰ ${period}</span>
          <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">(${durationHours} 小時彈性時段)</span>
        </div>
        <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
          <span class="capacity-pill ${cap.emsFull ? 'full' : 'available'}">
            🚑 救護 ${cap.emsOccupants.length}/4 ${cap.emsFull ? '🔴滿額' : '🟢可站位'}
          </span>
          <span class="capacity-pill ${cap.deskFull ? 'full' : 'available'}">
            🏢 值班 ${cap.deskOccupants.length}/1 ${cap.deskFull ? '🔴滿額' : '🟢可站位'}
          </span>
        </div>
      </div>

      <div class="slot-section-title">
        <span style="color: #38bdf8;">🚑 協勤救護（限額 4 位・隊上待命隨車出勤・先填先站位）</span>
        <span style="color: var(--text-muted); font-size: 0.75rem;">
          ${cap.emsFull ? '⚠️ 席次已滿' : `尚餘 ${cap.emsAvailable} 個席位`}
        </span>
      </div>
      <div class="slot-seats-grid-4">
        ${emsSeatsHtml}
      </div>

      <div class="slot-section-title">
        <span style="color: #c084fc;">🏢 協勤值班（限額 1 位・值班台・先填先站位）</span>
        <span style="color: var(--text-muted); font-size: 0.75rem;">
          ${cap.deskFull ? '⚠️ 席次已滿' : '尚有 1 個席位'}
        </span>
      </div>
      <div class="slot-seats-grid-1">
        ${deskSeatHtml}
      </div>
    `;

    container.appendChild(card);
  });

  // 綁定「⚡ 先填先站位」點擊事件
  container.querySelectorAll('.btn-seat-claim').forEach(btn => {
    btn.addEventListener('click', () => {
      const dt = btn.getAttribute('data-date');
      const pr = btn.getAttribute('data-period');
      const cat = btn.getAttribute('data-category');
      claimSlotInstantly(dt, pr, cat);
    });
  });

  // 綁定「🚨 遇突發狀況取消預定」點擊事件
  container.querySelectorAll('.btn-seat-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      const shiftId = btn.getAttribute('data-shift-id');
      openEmergencyCancelModal(shiftId);
    });
  });

  // 設定新增自訂時段按鈕
  const btnAdd = document.getElementById('btnDayDetailAddShift');
  if (btnAdd) {
    btnAdd.onclick = () => {
      modal.classList.remove('open');
      const selectDate = document.getElementById('inputShiftDate');
      if (selectDate) selectDate.value = dateKey;
      const curUser = getCurrentMember();
      document.getElementById('inputShiftMemberName').value = curUser.name;
      if (window.updateModalQuotaPreview) window.updateModalQuotaPreview(curUser);
      document.getElementById('modalClaimShift')?.classList.add('open');
      if (typeof updateFlexibleTimeInputs === 'function') updateFlexibleTimeInputs(true);
      updateClaimModalSlotMeter();
    };
  }

  modal.classList.add('open');
}

// 渲染清單視圖 (Table List View)
function renderScheduleListView() {
  const tbody = document.getElementById('scheduleTbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const filterVehicle = document.getElementById('calFilterVehicle')?.value || 'ALL';
  const curUser = getCurrentMember();
  const isOfficer = isCurrentOfficer();

  const monthStr = String(calCurrentMonth).padStart(2, '0');
  const monthPrefix = `${calCurrentYear}-${monthStr}-`;

  let list = shifts.filter(s => s.date?.startsWith(monthPrefix) || (calCurrentMonth === 10 && !s.date?.includes('-')));
  if (filterVehicle !== 'ALL') {
    if (filterVehicle === '救護協勤') {
      list = list.filter(s => !s.vehicle.includes('值班'));
    } else if (filterVehicle === '值班台') {
      list = list.filter(s => s.vehicle.includes('值班'));
    } else {
      list = list.filter(s => s.vehicle === filterVehicle);
    }
  }
  // 僅呈現實際登記同仁（不留缺額警示）
  list = list.filter(s => s.memberName && s.status !== '缺協勤');

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2rem;">民國 ${calCurrentYear} 年 ${calCurrentMonth} 月尚無排班紀錄，可隨時點擊「➕ 登記協勤時段」新增！</td></tr>`;
    return;
  }

  list.forEach(s => {
    const tr = document.createElement('tr');
    const isMine = s.memberName === curUser.name;
    const isDesk = s.vehicle.includes('值班');
    const vClass = isDesk ? 'v-desk' : 'v-ems';
    const vDisplay = isDesk ? s.vehicle : '🚑 救護協勤 (隊上待命)';
    
    let actionBtnHtml = '';
    if (isMine || isOfficer) {
      actionBtnHtml = `
        <button class="btn-secondary btn-cancel-shift" data-shift-id="${s.id}" style="font-size: 0.72rem; padding: 2px 8px; color: #f87171; border-color: rgba(239,68,68,0.4);">
          ❌ 取消預約
        </button>
      `;
    } else {
      actionBtnHtml = `<span style="color: var(--text-dim); font-size: 0.8rem;">已排定</span>`;
    }

    tr.innerHTML = `
      <td><strong>${s.date}</strong></td>
      <td>${s.dayOfWeek || ''}</td>
      <td><span class="vehicle-pill ${vClass}">${vDisplay}</span></td>
      <td><span style="font-family: var(--font-display); font-weight: 600;">${s.period}</span></td>
      <td><span style="font-size: 0.8rem; color: var(--text-muted);">${s.shiftType}</span></td>
      <td>
        <span style="color: #38bdf8; font-weight: 600;">${s.memberName} ${isMine ? '★' : ''}</span>
      </td>
      <td>
        <span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 99px; background: rgba(16,185,129,0.15); color: #34d399;">
          ${s.status}
        </span>
      </td>
      <td>
        ${actionBtnHtml}
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 綁定認領與取消事件
  tbody.querySelectorAll('.btn-claim-shift').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const shiftId = e.target.getAttribute('data-shift-id');
      const shift = shifts.find(item => item.id === shiftId);
      if (!shift) return;

      const targetMember = getCurrentMember();
      const validation = validateShiftBooking(targetMember, shift.date, shift.vehicle, shift.period, shift.shiftType, shift.id, false);

      if (!validation.ok) {
        alert(validation.reason);
        playFeedbackSound('alert');
        return;
      }

      shift.memberName = targetMember.name;
      shift.status = '已排班';
      Store.set('shifts', shifts);
      updateAllViews();
      const vDisplay = shift.vehicle && shift.vehicle.includes('值班') ? shift.vehicle : '救護待命';
      showToast(`成功認領 ${shift.date} (${vDisplay} ${shift.period})！`, '🎉');
      playFeedbackSound('success');
    });
  });

  tbody.querySelectorAll('.btn-cancel-shift').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const shiftId = e.target.getAttribute('data-shift-id');
      cancelShift(shiftId);
    });
  });
}

function setupCalendarControls() {
  // 視圖切換 (月曆網格 vs 清單列表)
  const btnCal = document.getElementById('btnViewCalendar');
  const btnList = document.getElementById('btnViewList');
  const viewCal = document.getElementById('calendarVisualView');
  const viewList = document.getElementById('calendarListView');

  btnCal?.addEventListener('click', () => {
    btnCal.classList.add('active');
    btnList.classList.remove('active');
    viewCal.style.display = 'block';
    viewList.style.display = 'none';
  });

  btnList?.addEventListener('click', () => {
    btnList.classList.add('active');
    btnCal.classList.remove('active');
    viewCal.style.display = 'none';
    viewList.style.display = 'block';
    renderScheduleListView();
  });

  // 篩選勤務類別
  document.getElementById('calFilterVehicle')?.addEventListener('change', () => {
    renderVisualCalendar();
    renderScheduleListView();
  });

  // 高亮我的排班
  document.getElementById('calHighlightMe')?.addEventListener('change', () => {
    renderVisualCalendar();
  });

  // 僅看缺額按鈕
  const btnVacantOnly = document.getElementById('btnFilterVacantOnly');
  btnVacantOnly?.addEventListener('click', () => {
    calFilterVacantOnly = !calFilterVacantOnly;
    btnVacantOnly.style.borderColor = calFilterVacantOnly ? 'var(--rescue-red)' : 'var(--border-subtle)';
    btnVacantOnly.style.color = calFilterVacantOnly ? '#ef4444' : 'var(--text-main)';
    renderVisualCalendar();
    renderScheduleListView();
    showToast(calFilterVacantOnly ? '已過濾：僅顯示尚有缺協勤之班次' : '已重設：顯示全月所有班次', '🔍');
  });

  // 一鍵清空排班（測試專用）
  document.getElementById('btnClearAllShiftsTest')?.addEventListener('click', async () => {
    if (confirm('🧹 確定要清空全月預定的排班表資料嗎？\n\n清空後日曆將呈現乾淨無班表狀態，方便您自行重新預約測試。')) {
      shifts = [];
      Store.set('shifts', []);
      if (supabaseClient) {
        try {
          await supabaseClient.from('shifts').delete().neq('id', '');
        } catch (e) {
          console.warn('Supabase delete all shifts failed:', e);
        }
      }
      renderSchedule();
    }
  });

  // 一鍵清空全系統所有測試資料（包括出勤、簽到退、排班與戰績歸零）
  document.getElementById('btnClearAllTestData')?.addEventListener('click', async () => {
    if (confirm('🗑️ 確定要清空全系統所有的測試資料嗎？\n\n將執行以下重置：\n1. 清空所有【簽到退/協勤打卡】紀錄\n2. 清空所有【緊急救護出勤】案件\n3. 清空全月【預約排班表】\n4. 清空所有【臨時取消排班】日誌\n5. 全體 54 位義消同仁的時數、出勤趟數、急救戰績 (ROSC/ECG/IV) 全部歸零\n6. 解除所有管制處分\n\n（義消名冊中的姓名、電話、證號與編組維持不變）')) {
      shifts = [];
      Store.set('shifts', []);
      attendance = [];
      Store.set('attendance', []);
      dispatches = [];
      Store.set('dispatches', []);
      cancellationLogs = [];
      Store.set('cancellation_logs', []);
      announcements = [];
      Store.set('announcements', []);
      activeDuty = null;
      Store.set('activeDuty', null);

      members = INITIAL_MEMBERS.map(m => ({
        ...m,
        totalHours: 0.0,
        totalDispatches: 0,
        roscCount: 0,
        ecgCount: 0,
        ivCount: 0,
        isRestricted: false,
        restrictionUntil: null,
        makeupTrainingStatus: 'eligible'
      }));
      Store.set('members', members);

      if (supabaseClient) {
        try {
          await supabaseClient.from('shifts').delete().neq('id', '');
        } catch (e) {
          console.warn('Supabase delete all shifts failed:', e);
        }
      }

      updateAllViews();
      renderSchedule();
      showToast('所有測試資料已完全清空，系統數據已歸零！', '🧹');
    }
  });

  // 制度與三階段規則展開按鈕
  document.getElementById('btnToggleRuleDetail')?.addEventListener('click', () => {
    const box = document.getElementById('ruleDetailBox');
    const btn = document.getElementById('btnToggleRuleDetail');
    if (!box) return;
    const isHidden = box.style.display === 'none';
    box.style.display = isHidden ? 'block' : 'none';
    if (btn) btn.textContent = isHidden ? '收合三階段處置規則' : '查看三階段處置規則';
  });

  // 月份導覽按鈕
  document.getElementById('btnPrevMonth')?.addEventListener('click', () => {
    calCurrentMonth--;
    if (calCurrentMonth < 1) {
      calCurrentMonth = 12;
      calCurrentYear--;
    }
    populateShiftDatesDropdown();
    renderSchedule();
    showToast(`已切換至 民國 ${calCurrentYear} 年 ${calCurrentMonth} 月`, '📅');
  });

  document.getElementById('btnNextMonth')?.addEventListener('click', () => {
    calCurrentMonth++;
    if (calCurrentMonth > 12) {
      calCurrentMonth = 1;
      calCurrentYear++;
    }
    populateShiftDatesDropdown();
    renderSchedule();
    showToast(`已切換至 民國 ${calCurrentYear} 年 ${calCurrentMonth} 月`, '📅');
  });

  document.getElementById('btnTodayMonth')?.addEventListener('click', () => {
    calCurrentYear = 115;
    calCurrentMonth = 10;
    populateShiftDatesDropdown();
    renderSchedule();
    showToast('已跳轉回本月 (民國 115 年 10 月)', '📅');
  });
}

function renderSchedule() {
  renderVisualCalendar();
  renderScheduleListView();
  updatePersonalQuotaUI();
  renderOfficerAuditPanel();
  renderReleasedFeed();
}


// 承辦人專區：全隊月報彙整表渲染
function renderSummaryReports() {
  const tbody = document.getElementById('summaryReportTbody');
  tbody.innerHTML = '';

  members.forEach((m, idx) => {
    const memberAtt = attendance.filter(a => a.memberName === m.name && a.date.startsWith('115-10'));
    const days = memberAtt.length;
    const hours = memberAtt.reduce((sum, a) => sum + (Number(a.hours) || 0), 0);
    const actualDisp = dispatches.filter(d => 
      (Array.isArray(d.memberNames) && d.memberNames.includes(m.name)) ||
      (Array.isArray(d.members) && d.members.includes(m.name)) ||
      d.memberName === m.name
    );
    const dispatchesCount = Math.max(
      memberAtt.reduce((sum, a) => sum + (Number(a.dispatches) || 0), 0),
      actualDisp.length
    );
    const patientsCount = Math.max(
      memberAtt.reduce((sum, a) => sum + (Number(a.patients) || 0), 0),
      actualDisp.reduce((sum, d) => sum + (Number(d.patientCount) || 1), 0)
    );
    const mealTimes = memberAtt.filter(a => Number(a.hours) >= 4).length;
    const mealAmount = mealTimes * 100;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><strong>${m.name}</strong></td>
      <td>${m.level} (${m.role})</td>
      <td>${days} 天</td>
      <td style="font-weight: 700; color: #38bdf8;">${hours.toFixed(1)} 小時</td>
      <td>${dispatchesCount} 趟</td>
      <td>${patientsCount} 人</td>
      <td>${mealTimes} 次</td>
      <td style="font-weight: 700; color: #34d399;">$ ${mealAmount}</td>
    `;
    tbody.appendChild(tr);
  });

  // 渲染出勤明細清單預覽
  const dispatchTbody = document.getElementById('dispatchReportTbody');
  if (dispatchTbody) {
    dispatchTbody.innerHTML = '';
    dispatches.slice(0, 30).forEach((d, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${d.caseNo}</td>
        <td>${d.date}</td>
        <td>${d.vehicle}</td>
        <td>${d.departureTime}~${d.returnTime}</td>
        <td>${d.location}</td>
        <td>${d.memberNames.join('、')}</td>
        <td>${d.treatments.join(', ')}</td>
        <td>${d.isIdle ? '空跑' : (d.patientCount || 1) + '人'}</td>
      `;
      dispatchTbody.appendChild(tr);
    });
  }
}

let chartDailyStaffingInstance = null;
let chartVehicleBreakdownInstance = null;

function renderOfficerExecutiveDashboard() {
  updateTodayStatus();
  const total = shifts.length;
  const scheduled = shifts.filter(s => s.memberName && s.status !== '缺協勤').length;
  const vacant = total - scheduled;
  const coverageRate = total > 0 ? ((scheduled / total) * 100).toFixed(1) : '0';

  const elRate = document.getElementById('dashKpiCoverageRate');
  const elDetail = document.getElementById('dashKpiCoverageDetail');
  const elBar = document.getElementById('dashKpiCoverageBar');
  if (elRate) elRate.textContent = `${coverageRate}%`;
  if (elDetail) elDetail.innerHTML = `已排定 <strong>${scheduled}</strong> / 總需求 <strong>${total}</strong> 班 ｜ 缺額：<strong style="color: #f87171;">${vacant} 班</strong>`;
  if (elBar) elBar.style.width = `${coverageRate}%`;

  // Dispatches count
  const totalDisp = dispatches.length;
  const totalPat = dispatches.reduce((acc, d) => acc + (d.patientCount || 0), 0);
  const elDisp = document.getElementById('dashKpiDispatches');
  if (elDisp) elDisp.textContent = `${totalDisp} 趟 / ${totalPat} 人`;
  const elDispDetail = document.getElementById('dashKpiDispatchesDetail');
  if (elDispDetail) {
    const dryRuns = dispatches.filter(d => (d.patientCount || 0) === 0 || (d.resultType && d.resultType.includes('未送醫'))).length;
    const dryRate = totalDisp > 0 ? ((dryRuns / totalDisp) * 100).toFixed(1) : '0';
    const avgPerDay = (totalDisp / 31).toFixed(2);
    elDispDetail.innerHTML = `空跑案件：<strong>${dryRuns} 趟</strong> (${dryRate}%) ｜ 日均出勤：<strong>${avgPerDay} 趟</strong>`;
  }

  // ROSC & ECG
  const roscCount = members.reduce((sum, m) => sum + (Number(m.roscCount) || 0), 0);
  const elRosc = document.getElementById('dashKpiRosc');
  if (elRosc) elRosc.textContent = `${roscCount} 件 ROSC`;
  const ecgCount = members.reduce((sum, m) => sum + (Number(m.ecgCount) || 0), 0);
  const elEcg = document.getElementById('dashKpiEcg');
  if (elEcg) elEcg.innerHTML = `12-Lead 心電圖到院前傳輸：<strong>${ecgCount} 件</strong>`;

  // Compliance
  const restricted = members.filter(m => m.isRestricted).length;
  const compRate = members.length > 0 ? (((members.length - restricted) / members.length) * 100).toFixed(1) : '100';
  const elComp = document.getElementById('dashKpiCompliance');
  if (elComp) {
    elComp.textContent = `${compRate}%`;
    elComp.style.color = restricted > 0 ? '#f87171' : '#34d399';
  }
  const elCompDetail = document.getElementById('dashKpiComplianceDetail');
  if (elCompDetail) {
    const compCount = members.length - restricted;
    elCompDetail.innerHTML = `合規隊員：<strong>${compCount} 位</strong> ｜ 處分管制期：<strong style="color: ${restricted > 0 ? '#ef4444' : '#10b981'};">${restricted} 位</strong>`;
  }

  // Fill Table
  const tbody = document.getElementById('dashOfficerTableTbody');
  if (tbody) {
    tbody.innerHTML = '';
    const sorted = [...members].sort((a, b) => (Number(b.totalHours) || 0) - (Number(a.totalHours) || 0));
    sorted.forEach((m, idx) => {
      const memberAtt = attendance.filter(a => a.memberName === m.name && a.date.startsWith('115-10'));
      const days = memberAtt.length;
      const hours = memberAtt.reduce((sum, a) => sum + (Number(a.hours) || 0), 0);
      const actualDisp = dispatches.filter(d => 
        (Array.isArray(d.memberNames) && d.memberNames.includes(m.name)) ||
        (Array.isArray(d.members) && d.members.includes(m.name)) ||
        d.memberName === m.name
      );
      const dispatchesCount = Math.max(
        memberAtt.reduce((sum, a) => sum + (Number(a.dispatches) || 0), 0),
        actualDisp.length
      );
      const patientsCount = Math.max(
        memberAtt.reduce((sum, a) => sum + (Number(a.patients) || 0), 0),
        actualDisp.reduce((sum, d) => sum + (Number(d.patientCount) || 1), 0)
      );
      const mealTimes = memberAtt.filter(a => Number(a.hours) >= 4).length;
      const mealAmount = mealTimes * 100;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong style="color: ${idx < 3 ? '#fbbf24' : 'var(--text-main)'};"># ${idx + 1}</strong></td>
        <td><strong>${m.name}</strong></td>
        <td><code style="font-size: 0.75rem; color: var(--text-dim);">${m.idNo || '—'}</code></td>
        <td>${m.role} (${m.level})</td>
        <td>${days} 天</td>
        <td><strong style="color: #38bdf8;">${hours.toFixed(1)} hr</strong></td>
        <td>${dispatchesCount} 趟</td>
        <td>${patientsCount} 人</td>
        <td>${mealTimes} 次</td>
        <td><strong style="color: #34d399;">$ ${mealAmount}</strong></td>
        <td>
          ${m.isRestricted 
            ? `<span style="background: rgba(239,68,68,0.2); color: #f87171; padding: 2px 6px; border-radius: 99px; font-size: 0.75rem; font-weight: 700;">⛔ 處分管制中</span>` 
            : `<span style="background: rgba(16,185,129,0.15); color: #34d399; padding: 2px 6px; border-radius: 99px; font-size: 0.75rem;">✅ 正常合規</span>`}
          ${isSuperAdmin() ? `<button class="btn-admin-edit btn-admin-edit-mem-kpi" data-id="${m.id}" style="margin-left: 6px; font-size: 0.72rem; padding: 2px 6px;">✏️ 編輯</button>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (isSuperAdmin()) {
      tbody.querySelectorAll('.btn-admin-edit-mem-kpi').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          openAdminEditMemberModal(id);
        });
      });
    }
  }

  // Render Charts if Chart.js is loaded
  if (typeof Chart !== 'undefined') {
    // Chart 1: Daily Staffing Trend (Days 1~31)
    const ctx1 = document.getElementById('chartDailyStaffing')?.getContext('2d');
    if (ctx1) {
      const labels = [];
      const scheduledData = [];
      const vacantData = [];
      for (let d = 1; d <= 31; d++) {
        labels.push(`${d}日`);
        const dayShifts = shifts.filter(s => s.day === d || s.date.endsWith(`-${String(d).padStart(2, '0')}`));
        const sched = dayShifts.filter(s => s.memberName && s.status !== '缺協勤').length;
        const vac = dayShifts.length - sched;
        scheduledData.push(sched);
        vacantData.push(vac);
      }

      if (chartDailyStaffingInstance) chartDailyStaffingInstance.destroy();
      chartDailyStaffingInstance = new Chart(ctx1, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: '已排班人力 (人次)',
              data: scheduledData,
              backgroundColor: '#38bdf8',
              borderRadius: 4
            },
            {
              label: '待補缺額 (班次)',
              data: vacantData,
              backgroundColor: 'rgba(239, 68, 68, 0.75)',
              borderRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
            y: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', stepSize: 1 } }
          },
          plugins: {
            legend: { labels: { color: '#e2e8f0', font: { size: 11 } } }
          }
        }
      });
    }

    // Chart 2: 協勤性質佔比 Donut
    const ctx2 = document.getElementById('chartVehicleBreakdown')?.getContext('2d');
    if (ctx2) {
      const countEms = shifts.filter(s => !s.vehicle.includes('值班')).length;
      const countDesk = shifts.filter(s => s.vehicle.includes('值班')).length;

      if (chartVehicleBreakdownInstance) chartVehicleBreakdownInstance.destroy();
      chartVehicleBreakdownInstance = new Chart(ctx2, {
        type: 'doughnut',
        data: {
          labels: ['救護協勤 (隊上待命)', '值班台 (含補定訓)'],
          datasets: [{
            data: [countEms, countDesk],
            backgroundColor: ['#38bdf8', '#a855f7'],
            borderColor: '#0f172a',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { color: '#e2e8f0', font: { size: 11 } } }
          }
        }
      });
    }
  }
}

// ==========================================
// 3.8 分隊重要事項公告欄 (具顯示期限管制)
// ==========================================
function isAnnouncementActive(ann) {
  if (!ann) return false;
  if (!ann.endDate) return true;
  const todayStr = normalizeRocDateStr(getCurrentRocDate());
  const endStr = normalizeRocDateStr(ann.endDate);
  return endStr >= todayStr;
}

function getDaysRemaining(endDateStr) {
  if (!endDateStr) return null;
  const norm = normalizeRocDateStr(endDateStr);
  const parts = norm.split('-').map(Number);
  if (parts.length !== 3) return null;
  const targetDate = new Date(parts[0] + 1911, parts[1] - 1, parts[2], 23, 59, 59);
  const now = new Date();
  const diffTime = targetDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

function openNewAnnouncementModal() {
  document.getElementById('modalAnnouncementTitle').textContent = '📢 發布分隊重要事項公告';
  document.getElementById('editAnnouncementId').value = '';
  document.getElementById('annTitle').value = '';
  document.getElementById('annCategory').value = '一般隊務';
  document.getElementById('annPriority').value = 'normal';
  document.getElementById('annContent').value = '';
  
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const rocY = nextWeek.getFullYear() - 1911;
  const mm = String(nextWeek.getMonth() + 1).padStart(2, '0');
  const dd = String(nextWeek.getDate()).padStart(2, '0');
  document.getElementById('annEndDate').value = `${rocY}-${mm}-${dd}`;
  document.getElementById('annIsPinned').checked = false;
  document.getElementById('btnSubmitAnnouncementText').textContent = '📢 確認發布公告';

  document.getElementById('modalNewAnnouncement')?.classList.add('open');
}

function openEditAnnouncementModal(id) {
  const ann = announcements.find(a => a.id === id);
  if (!ann) return;

  document.getElementById('modalAnnouncementTitle').textContent = '✏️ 編輯分隊公告與期限';
  document.getElementById('editAnnouncementId').value = ann.id;
  document.getElementById('annTitle').value = ann.title || '';
  document.getElementById('annCategory').value = ann.category || '一般隊務';
  document.getElementById('annPriority').value = ann.priority || 'normal';
  document.getElementById('annContent').value = ann.content || '';
  document.getElementById('annEndDate').value = ann.endDate || '';
  document.getElementById('annIsPinned').checked = !!ann.isPinned;
  document.getElementById('btnSubmitAnnouncementText').textContent = '💾 儲存變更';

  document.getElementById('modalNewAnnouncement')?.classList.add('open');
}

function renderAnnouncements() {
  const container = document.getElementById('announcementListContainer');
  const badge = document.getElementById('announcementActiveBadge');
  const btnNew = document.getElementById('btnOpenNewAnnouncementModal');
  const lblHistory = document.getElementById('lblToggleHistory');

  if (btnNew) {
    btnNew.style.display = isSuperAdmin() ? 'inline-flex' : 'none';
  }

  if (lblHistory) {
    lblHistory.textContent = showHistoryAnnouncements ? '🔙 返回有效公告' : '📜 查看歷史公告';
  }

  const activeList = announcements.filter(a => isAnnouncementActive(a));

  // 同步更新首頁頂部即時公告醒目橫幅 (#topAnnouncementAlert)
  const topAlert = document.getElementById('topAnnouncementAlert');
  const topAlertTitle = document.getElementById('topAnnouncementTitle');
  const topAlertAuthor = document.getElementById('topAnnouncementAuthor');

  if (topAlert) {
    if (activeList.length > 0) {
      const topAnn = activeList.find(a => a.isPinned) || activeList[0];
      if (topAlertTitle) topAlertTitle.textContent = topAnn.title;
      if (topAlertAuthor) topAlertAuthor.textContent = `發布者：${topAnn.author || '分隊警消承辦人'} ｜ 有效期限至 ${topAnn.endDate}`;
      topAlert.style.display = 'block';
      topAlert.onclick = () => {
        document.getElementById('announcementBoard')?.scrollIntoView({ behavior: 'smooth' });
      };
    } else {
      topAlert.style.display = 'none';
    }
  }

  if (!container) return;
  
  if (badge) {
    badge.textContent = `${activeList.length} 則有效公告`;
    badge.style.background = activeList.length > 0 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.05)';
    badge.style.color = activeList.length > 0 ? '#38bdf8' : 'var(--text-dim)';
  }

  let displayList = showHistoryAnnouncements ? [...announcements] : [...activeList];

  // 排序：置頂優先，接著依建立時間新到舊
  displayList.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  if (displayList.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 1.25rem 1rem; background: rgba(255,255,255,0.02); border-radius: 8px; border: 1px dashed rgba(255,255,255,0.08);">
        <div style="font-size: 1.3rem; margin-bottom: 0.35rem;">🕊️</div>
        <div style="font-size: 0.85rem; color: var(--text-muted); font-weight: 500;">
          ${showHistoryAnnouncements ? '尚無任何歷史公告紀錄' : '目前尚無待辦重要公告，祝全體協勤同仁執勤平安！'}
        </div>
        ${isSuperAdmin() && !showHistoryAnnouncements ? `
          <button id="btnEmptyCreateAnn" class="btn-primary" style="margin-top: 0.75rem; font-size: 0.76rem; padding: 0.3rem 0.75rem; background: linear-gradient(135deg, #0284c7, #0369a1); border: none;">
            <span>➕ 立即發布第一則分隊公告</span>
          </button>
        ` : ''}
      </div>
    `;

    document.getElementById('btnEmptyCreateAnn')?.addEventListener('click', () => {
      openNewAnnouncementModal();
    });
    return;
  }

  container.innerHTML = '';

  displayList.forEach(ann => {
    const isActive = isAnnouncementActive(ann);
    const daysLeft = getDaysRemaining(ann.endDate);

    let priorityBorder = '#38bdf8';
    let priorityBg = 'rgba(56, 189, 248, 0.04)';
    if (ann.priority === 'urgent') {
      priorityBorder = '#ef4444';
      priorityBg = 'rgba(239, 68, 68, 0.06)';
    } else if (ann.priority === 'warning') {
      priorityBorder = '#f59e0b';
      priorityBg = 'rgba(245, 158, 11, 0.06)';
    }

    let deadlineBadgeHtml = '';
    if (!isActive) {
      deadlineBadgeHtml = `<span style="background: rgba(148, 163, 184, 0.2); color: #94a3b8; font-size: 0.72rem; padding: 2px 7px; border-radius: 99px;">⛔ 已過期 (${ann.endDate})</span>`;
    } else if (daysLeft !== null) {
      if (daysLeft <= 1) {
        deadlineBadgeHtml = `<span style="background: rgba(239, 68, 68, 0.2); color: #f87171; font-size: 0.72rem; padding: 2px 7px; border-radius: 99px; font-weight: 600;">⚠️ 今日截止 (${ann.endDate})</span>`;
      } else {
        deadlineBadgeHtml = `<span style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 0.72rem; padding: 2px 7px; border-radius: 99px;">⏳ 剩餘 ${daysLeft} 天 (至 ${ann.endDate})</span>`;
      }
    }

    const item = document.createElement('div');
    item.className = 'glass-card';
    item.style.cssText = `
      padding: 0.9rem 1.1rem;
      border-left: 4px solid ${priorityBorder};
      background: ${priorityBg};
      margin: 0;
      transition: transform 0.2s, box-shadow 0.2s;
    `;

    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.4rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <span class="badge-role" style="font-size: 0.72rem; padding: 2px 7px; background: rgba(255,255,255,0.08);">${ann.category || '一般隊務'}</span>
          ${ann.isPinned ? `<span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; font-weight: 700;">📌 置頂</span>` : ''}
          <strong style="font-size: 0.96rem; color: #f8fafc; letter-spacing: 0.3px;">${ann.title}</strong>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          ${deadlineBadgeHtml}
          ${isSuperAdmin() ? `
            <div style="display: flex; gap: 0.3rem;">
              <button class="btn-admin-edit btn-edit-ann" data-id="${ann.id}" style="font-size: 0.72rem; padding: 2px 7px;" title="編輯公告內容或延長期限">✏️ 編輯</button>
              <button class="btn-secondary btn-del-ann" data-id="${ann.id}" style="font-size: 0.72rem; padding: 2px 7px; color: #f87171; border-color: rgba(239, 68, 68, 0.3);" title="刪除此公告">🗑️ 刪除</button>
            </div>
          ` : ''}
        </div>
      </div>
      <div style="font-size: 0.85rem; line-height: 1.6; color: #cbd5e1; white-space: pre-wrap; margin-bottom: 0.45rem;">${ann.content}</div>
      <div style="font-size: 0.72rem; color: var(--text-dim); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; border-top: 1px solid rgba(255,255,255,0.04); padding-top: 0.35rem;">
        <span>✍️ 發布人：${ann.author || '分隊警消承辦人'}</span>
        <span>🕒 發布時間：${ann.createdDateStr || ann.startDate || '—'}</span>
      </div>
    `;

    container.appendChild(item);
  });

  if (isSuperAdmin()) {
    container.querySelectorAll('.btn-edit-ann').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        openEditAnnouncementModal(id);
      });
    });

    container.querySelectorAll('.btn-del-ann').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const ann = announcements.find(a => a.id === id);
        if (!ann) return;
        if (confirm(`確定要刪除公告【${ann.title}】嗎？`)) {
          announcements = announcements.filter(a => a.id !== id);
          Store.set('announcements', announcements);
          deleteAnnouncementFromSupabase(id);
          renderAnnouncements();
          notifyCrossTabSync();
          showToast('公告已順利刪除！', '🗑️');
        }
      });
    });
  }
}

function setupAnnouncementEvents() {
  document.getElementById('btnOpenNewAnnouncementModal')?.addEventListener('click', () => {
    openNewAnnouncementModal();
  });

  document.getElementById('btnToggleHistoryAnnouncements')?.addEventListener('click', () => {
    showHistoryAnnouncements = !showHistoryAnnouncements;
    renderAnnouncements();
  });

  // 快速期限按鈕
  document.querySelectorAll('.btn-quick-ann-deadline').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const days = e.currentTarget.getAttribute('data-days');
      const now = new Date();
      let target = new Date();

      if (days === 'end_of_month') {
        target = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      } else {
        const numDays = parseInt(days, 10) || 7;
        target = new Date(now.getTime() + numDays * 24 * 60 * 60 * 1000);
      }

      const rocY = target.getFullYear() - 1911;
      const mm = String(target.getMonth() + 1).padStart(2, '0');
      const dd = String(target.getDate()).padStart(2, '0');
      document.getElementById('annEndDate').value = `${rocY}-${mm}-${dd}`;
    });
  });

  // 表單送出
  document.getElementById('formNewAnnouncement')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const editId = document.getElementById('editAnnouncementId').value;
    const title = document.getElementById('annTitle').value.trim();
    const category = document.getElementById('annCategory').value;
    const priority = document.getElementById('annPriority').value;
    const content = document.getElementById('annContent').value.trim();
    const endDate = document.getElementById('annEndDate').value.trim();
    const isPinned = document.getElementById('annIsPinned').checked;

    if (!title || !content || !endDate) {
      alert('請填寫完整公告標題、詳細內容與顯示期限！');
      return;
    }

    const todayStr = getCurrentRocDate();
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (editId) {
      const ann = announcements.find(a => a.id === editId);
      if (ann) {
        ann.title = title;
        ann.category = category;
        ann.priority = priority;
        ann.content = content;
        ann.endDate = endDate;
        ann.isPinned = isPinned;
        pushAnnouncementToSupabase(ann);
        showToast(`公告【${title}】已成功更新！`, '💾');
      }
    } else {
      const newAnn = {
        id: `ann-${Date.now()}`,
        title,
        category,
        priority,
        content,
        startDate: todayStr,
        endDate,
        author: '分隊警消承辦人',
        createdDateStr: `${todayStr} ${timeStr}`,
        createdAt: Date.now(),
        isPinned
      };
      announcements.unshift(newAnn);
      pushAnnouncementToSupabase(newAnn);
      showToast(`重要公告【${title}】已成功發布！有效期限至 ${endDate} 止`, '📢');
    }

    Store.set('announcements', announcements);
    document.getElementById('modalNewAnnouncement')?.classList.remove('open');
    renderAnnouncements();
    playFeedbackSound('success');
    notifyCrossTabSync();
  });
}

function updateAllViews() {
  updateUserNavbarUi();
  updateDutyHero();
  updatePersonalSummary();
  renderAnnouncements();
  renderRecentAttendance();
  renderDispatchList();
  renderBadges();
  renderSchedule();
  renderSummaryReports();
  renderOfficerExecutiveDashboard();
  renderAdminPasswordTrackingTable();
}

// ==========================================
// 4. 打卡計時器與操作事件
// ==========================================
function startClock() {
  setInterval(() => {
    const now = new Date();
    // 格式化當前時間 (24小時制)
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const clockEl = document.getElementById('clockLive');
    if (clockEl) clockEl.textContent = `當前系統時間 (24小時制)：${timeStr}`;

    // 如果當前隊員處於打卡狀態，計算時數
    const cur = getCurrentMember();
    if (activeDuty && activeDuty.memberId === cur.id) {
      const elapsedMs = Math.max(0, Date.now() - activeDuty.startTime);
      const totalSec = Math.floor(elapsedMs / 1000);
      const hrs = String(Math.floor(totalSec / 3600)).padStart(2, '0');
      const mins = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const secs = String(totalSec % 60).padStart(2, '0');
      const timerEl = document.getElementById('dutyTimerDisplay');
      if (timerEl) timerEl.textContent = `${hrs}:${mins}:${secs}`;

      const liveCell = document.getElementById('liveDutyHoursCell');
      if (liveCell) {
        const hVal = Math.max(0.1, Math.round((elapsedMs / 3600000) * 10) / 10);
        liveCell.textContent = `${hVal.toFixed(1)} hr`;
      }
    }
  }, 1000);
}

// 取得民國年月日格式 (例如: 115-10-07)
function getCurrentRocDate() {
  const now = new Date();
  const rocYear = now.getFullYear() - 1911;
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${rocYear}-${mm}-${dd}`;
}

// 時間字串轉換為當日累積分鐘 (例如 "09:30" -> 570)
function timeToMinutes(tStr) {
  if (!tStr) return 0;
  const [h, m] = tStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// 分鐘轉換為 HH:mm 格式
function minutesToTime(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// 全域智慧 24 小時制時間正規化函數 (支援 "8" -> "08:00", "20" -> "20:00", "2015" -> "20:15", "20:15" -> "20:15")
function normalizeTimeStr(tStr) {
  if (!tStr) return '';
  const s = cleanFlexibleTimeStr(tStr);
  if (s.includes(':')) {
    const [h, m] = s.split(':').map(Number);
    if (!isNaN(h)) {
      const clampH = Math.min(23, Math.max(0, h));
      const clampM = Math.min(59, Math.max(0, m || 0));
      return `${String(clampH).padStart(2, '0')}:${String(clampM).padStart(2, '0')}`;
    }
  }
  if (/^\d{4}$/.test(s)) {
    const h = Math.min(23, Number(s.slice(0, 2)));
    const m = Math.min(59, Number(s.slice(2, 4)));
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  if (/^\d{3}$/.test(s)) {
    const h = Number(s.slice(0, 1));
    const m = Math.min(59, Number(s.slice(1, 3)));
    return `0${h}:${String(m).padStart(2, '0')}`;
  }
  if (/^\d{1,2}$/.test(s)) {
    const h = Math.min(23, Number(s));
    return `${String(h).padStart(2, '0')}:00`;
  }
  return s;
}

// 綁定全站 24 小時制輸入框，即時防呆與自動格式化
function attachTime24hFormatters() {
  document.querySelectorAll('input.time-24h').forEach(input => {
    if (input._bound24h) return;
    input._bound24h = true;

    input.addEventListener('blur', () => {
      if (input.value.trim()) {
        input.value = normalizeTimeStr(input.value);
      }
    });

    input.addEventListener('input', () => {
      const v = cleanFlexibleTimeStr(input.value);
      if (/^\d{4}$/.test(v)) {
        input.value = `${v.slice(0, 2)}:${v.slice(2, 4)}`;
      }
    });
  });
}

// 核心打卡簽到執行邏輯
function performPunchIn(actualTimeStr = null, reason = '', dateVal = null) {
  if (!isLoggedIn()) {
    showToast('請先登入義消同仁帳號方可進行協勤簽到！', '⚠️');
    document.getElementById('modalLogin')?.classList.add('open');
    return;
  }
  const cur = getCurrentMember();
  const now = new Date();
  const dateStr = dateVal || getCurrentRocDate();
  const timeStr = actualTimeStr ? normalizeTimeStr(actualTimeStr) : `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  let startTimeMs = Date.now();
  if (actualTimeStr) {
    const norm = normalizeTimeStr(actualTimeStr);
    const [h, m] = norm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    startTimeMs = d.getTime();
  }

  // 1. 在 attendance 建立在隊簽到紀錄 (signOut 保持為空，代表值勤待命中)
  let attRecord = attendance.find(a => (a.memberId === cur.id || a.memberName === cur.name) && a.date === dateStr && (!a.signOut || a.signOut === '' || a.signOut === '—'));
  if (!attRecord) {
    attRecord = {
      id: `att-${cur.id}-${Date.now()}`,
      memberId: cur.id,
      memberName: cur.name,
      date: dateStr,
      signIn: timeStr,
      signOut: '',
      hours: 0,
      dispatches: 0,
      patients: 0,
      note: reason || '到隊協勤中'
    };
    attendance.unshift(attRecord);
  } else {
    attRecord.signIn = timeStr;
    if (reason) attRecord.note = reason;
  }
  Store.set('attendance', attendance);
  pushAttendanceToSupabase(attRecord);

  // 2. 記錄本機值勤會話 (供計時器使用)
  activeDuty = {
    memberId: cur.id,
    memberName: cur.name,
    startTime: startTimeMs,
    dateStr: dateStr,
    timeStr: timeStr,
    attendanceId: attRecord.id,
    isBackfilled: !!actualTimeStr,
    backfillReason: reason
  };
  Store.set('activeDuty', activeDuty);

  updateDutyHero();
  updateAllViews();
  playFeedbackSound('success');
  notifyCrossTabSync();
  
  if (actualTimeStr) {
    showToast(`補登成功！${cur.name} 已校正為 ${timeStr} 到隊協勤（在隊累積已同步起算）`, '📍');
  } else {
    showToast(`簽到成功！${cur.name} 已於 ${timeStr} 在博館分隊開始協勤`, '📍');
  }
}

// 核心簽退離隊執行邏輯
function performPunchOut(actualTimeStr = null, reason = '') {
  const cur = getCurrentMember();
  const now = new Date();
  const todayStr = getCurrentRocDate();
  const signOutTime = actualTimeStr ? normalizeTimeStr(actualTimeStr) : `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // 尋找此隊員今日尚未簽退的紀錄
  let attRecord = null;
  if (activeDuty && activeDuty.attendanceId) {
    attRecord = attendance.find(a => a.id === activeDuty.attendanceId);
  }
  if (!attRecord) {
    attRecord = attendance.find(a => (a.memberId === cur.id || a.memberName === cur.name) && a.date === todayStr && (!a.signOut || a.signOut === '' || a.signOut === '—'));
  }

  const signInTime = activeDuty ? activeDuty.timeStr : (attRecord ? attRecord.signIn : '18:00');
  const dateStr = activeDuty ? activeDuty.dateStr : (attRecord ? attRecord.date : todayStr);

  const inMin = timeToMinutes(signInTime);
  const outMin = timeToMinutes(signOutTime);
  let durationMinutes = outMin - inMin;
  if (durationMinutes < 0) durationMinutes += 24 * 60; // 跨班/跨夜情況

  const durationHours = Math.max(0.5, Math.round((durationMinutes / 60) * 10) / 10);
  const isMealEligible = durationHours >= 4.0;

  let note = '即時手機打卡協勤';
  if (activeDuty && activeDuty.isBackfilled && reason) {
    note = `補登到隊(${activeDuty.backfillReason})，校正離隊(${reason})`;
  } else if (activeDuty && activeDuty.isBackfilled) {
    note = `補登到隊協勤 (${activeDuty.backfillReason})`;
  } else if (reason) {
    note = `校正離隊協勤 (${reason})`;
  }

  if (attRecord) {
    attRecord.signOut = signOutTime;
    attRecord.hours = durationHours;
    attRecord.dispatches = 1;
    attRecord.patients = 1;
    attRecord.note = note;
  } else {
    attRecord = {
      id: `att-${Date.now()}`,
      memberId: cur.id,
      memberName: cur.name,
      date: dateStr,
      signIn: signInTime,
      signOut: signOutTime,
      hours: durationHours,
      dispatches: 1,
      patients: 1,
      note: note
    };
    attendance.unshift(attRecord);
  }

  Store.set('attendance', attendance);
  pushAttendanceToSupabase(attRecord);

  cur.totalHours = (Number(cur.totalHours) || 0) + durationHours;
  Store.set('members', members);

  if (activeDuty && activeDuty.memberId === cur.id) {
    activeDuty = null;
    Store.set('activeDuty', null);
  }

  updateAllViews();
  playFeedbackSound('success');
  notifyCrossTabSync();
  showToast(`簽退完成！本日協勤 ${durationHours} 小時已存入系統${isMealEligible ? '（符合誤餐費資格）' : ''}`, '🏁');
}

function setupPunchEvents() {
  const btnIn = document.getElementById('btnPunchIn');
  const btnOut = document.getElementById('btnPunchOut');

  const modalIn = document.getElementById('modalPunchInConfirm');
  const formIn = document.getElementById('formPunchInConfirm');
  const inputInName = document.getElementById('inputPunchInMemberName');
  const inputInDate = document.getElementById('inputPunchInDate');
  const inputInTime = document.getElementById('inputPunchInTime');
  const inputInNote = document.getElementById('inputPunchInNote');

  const modalOut = document.getElementById('modalPunchOutConfirm');
  const formOut = document.getElementById('formPunchOutConfirm');
  const inputOutName = document.getElementById('inputPunchOutMemberName');
  const boxNormal = document.getElementById('boxPunchOutNormalFields');
  const boxBackfill = document.getElementById('boxPunchOutBackfillFields');
  const displayInTime = document.getElementById('inputPunchOutSignInDisplay');
  const inputOutTime = document.getElementById('inputPunchOutTime');
  const inputBInTime = document.getElementById('inputPunchOutBackfillInTime');
  const inputBOutTime = document.getElementById('inputPunchOutBackfillOutTime');
  const inputOutNote = document.getElementById('inputPunchOutNote');

  // 1. 點擊【📍 簽到】按鈕：彈出簽到確認視窗 (預設當前日期時間，可手動修改)
  btnIn?.addEventListener('click', () => {
    if (!isLoggedIn()) {
      showToast('請先登入義消隊員帳號！', '⚠️');
      document.getElementById('modalLogin')?.classList.add('open');
      return;
    }

    const cur = getCurrentMember();
    const now = new Date();
    const nowTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (inputInName) inputInName.value = `${cur.name} (${cur.level || 'EMT'})`;
    if (inputInDate) inputInDate.value = getCurrentRocDate();
    if (inputInTime) inputInTime.value = nowTimeStr;
    if (inputInNote) inputInNote.value = '正常到隊協勤';

    modalIn?.classList.add('open');
  });

  // 簽到表單提交
  formIn?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!isLoggedIn()) return;
    const now = new Date();
    const fallbackTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const timeVal = normalizeTimeStr(inputInTime?.value || '') || fallbackTime;
    const dateVal = inputInDate?.value || getCurrentRocDate();
    const noteVal = inputInNote?.value || '正常到隊協勤';

    performPunchIn(timeVal, noteVal, dateVal);
    modalIn?.classList.remove('open');
  });

  // 2. 點擊【🏁 簽退】按鈕：彈出簽退確認視窗 (預設當前日期時間，可手動修改，即時試算時數)
  function updatePunchOutPreview() {
    let inMin = 0;
    let outMin = 0;

    if (activeDuty) {
      inMin = timeToMinutes(activeDuty.timeStr);
      outMin = timeToMinutes(normalizeTimeStr(inputOutTime?.value || '00:00'));
    } else {
      inMin = timeToMinutes(normalizeTimeStr(inputBInTime?.value || '18:00'));
      outMin = timeToMinutes(normalizeTimeStr(inputBOutTime?.value || '22:00'));
    }

    let diff = outMin - inMin;
    if (diff < 0) diff += 24 * 60; // 跨午夜
    const hrs = Math.max(0.5, Math.round((diff / 60) * 10) / 10);

    const hrsEl = document.getElementById('previewPunchOutHours');
    const mealEl = document.getElementById('previewPunchOutMeal');

    if (hrsEl) hrsEl.textContent = `${hrs.toFixed(1)} hr`;
    if (mealEl) {
      if (hrs >= 4.0) {
        mealEl.textContent = '✅ 符合誤餐費資格 ($100)';
        mealEl.style.color = '#34d399';
      } else {
        mealEl.textContent = '未達 4 小時 (無誤餐費)';
        mealEl.style.color = '#f87171';
      }
    }
  }

  inputOutTime?.addEventListener('input', updatePunchOutPreview);
  inputBInTime?.addEventListener('input', updatePunchOutPreview);
  inputBOutTime?.addEventListener('input', updatePunchOutPreview);

  btnOut?.addEventListener('click', () => {
    if (!isLoggedIn()) {
      showToast('請先登入義消隊員帳號！', '⚠️');
      document.getElementById('modalLogin')?.classList.add('open');
      return;
    }

    const cur = getCurrentMember();
    const now = new Date();
    const nowTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (inputOutName) inputOutName.value = `${cur.name} (${cur.level || 'EMT'})`;

    if (activeDuty) {
      // 正常有簽到模式
      if (boxNormal) boxNormal.style.display = 'block';
      if (boxBackfill) boxBackfill.style.display = 'none';
      if (displayInTime) displayInTime.value = `${activeDuty.dateStr} 📍 ${activeDuty.timeStr}`;
      if (inputOutTime) inputOutTime.value = nowTimeStr;
      if (inputOutNote) inputOutNote.value = '協勤完畢離隊';
    } else {
      // 尚未簽到 (返家補登模式)
      if (boxNormal) boxNormal.style.display = 'none';
      if (boxBackfill) boxBackfill.style.display = 'block';
      if (inputBInTime) {
        // 預設 4 小時前 (24小時制)
        const fourHrsAgo = Math.max(0, now.getHours() * 60 + now.getMinutes() - 240);
        inputBInTime.value = minutesToTime(fourHrsAgo);
      }
      if (inputBOutTime) inputBOutTime.value = nowTimeStr;
      if (inputOutNote) inputOutNote.value = '返家後才想起補簽到退';
    }

    updatePunchOutPreview();
    modalOut?.classList.add('open');
  });

  // 簽退表單提交
  formOut?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!isLoggedIn()) return;
    const cur = getCurrentMember();
    const noteVal = inputOutNote?.value || '協勤完畢離隊';

    if (activeDuty) {
      const chosenOutTime = normalizeTimeStr(inputOutTime?.value || '');
      performPunchOut(chosenOutTime, noteVal);
    } else {
      // 補登模式送出
      const inTime = normalizeTimeStr(inputBInTime?.value || '18:00');
      const outTime = normalizeTimeStr(inputBOutTime?.value || '22:00');
      const inMin = timeToMinutes(inTime);
      const outMin = timeToMinutes(outTime);
      let diff = outMin - inMin;
      if (diff < 0) diff += 24 * 60;
      const hrs = Math.max(0.5, Math.round((diff / 60) * 10) / 10);

      const newAtt = {
        id: `att-${Date.now()}`,
        memberId: cur.id,
        memberName: cur.name,
        date: getCurrentRocDate(),
        signIn: inTime,
        signOut: outTime,
        hours: hrs,
        dispatches: 1,
        patients: 1,
        note: noteVal
      };

      attendance.unshift(newAtt);
      Store.set('attendance', attendance);

      cur.totalHours = (Number(cur.totalHours) || 0) + hrs;
      Store.set('members', members);

      updateAllViews();
      playFeedbackSound('success');
      showToast(`補登簽退完成！已為【${cur.name}】記錄協勤 ${hrs} 小時（${inTime} ~ ${outTime}）！`, '🎉');
    }

    modalOut?.classList.remove('open');
  });

  // Modal 7: 值班台專屬打卡 QR Code
  const modalQr = document.getElementById('modalStationQr');
  document.getElementById('btnOpenStationQr')?.addEventListener('click', () => {
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    const targetUrl = `${cleanUrl}?action=checkin#tab-checkin`;
    const qrImg = document.getElementById('stationQrImg');
    if (qrImg) {
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(targetUrl)}`;
    }
    modalQr?.classList.add('open');
  });

  document.getElementById('btnPrintQrPoster')?.addEventListener('click', () => {
    window.print();
  });

  document.getElementById('btnCopyCheckinLink')?.addEventListener('click', () => {
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    const targetUrl = `${cleanUrl}?action=checkin#tab-checkin`;
    navigator.clipboard.writeText(targetUrl).then(() => {
      showToast('已複製值班台打卡直連網址！可貼入 LINE 群組', '📋');
    });
  });

  // 檢查 URL query 是否為掃碼直連打卡
  if (window.location.search.includes('action=checkin')) {
    setTimeout(() => {
      const cur = getCurrentMember();
      showToast(`👋 歡迎 ${cur.name} 抵達博館分隊！請點擊按鈕完成出入登記`, '📍');
    }, 400);
  }
}

// ==========================================
// 5. 警消最高全域管理權限 CRUD 核心操作與彈窗
// ==========================================
function openAdminEditAttendanceModal(recordId = null) {
  const modal = document.getElementById('modalAdminEditAttendance');
  if (!modal) return;
  const title = document.getElementById('adminAttModalTitle');
  const inputId = document.getElementById('adminAttRecordId');
  const selectMem = document.getElementById('adminAttMemberSelect');
  const inputDate = document.getElementById('adminAttDate');
  const inputSignIn = document.getElementById('adminAttSignIn');
  const inputSignOut = document.getElementById('adminAttSignOut');
  const inputHours = document.getElementById('adminAttHours');
  const inputDisp = document.getElementById('adminAttDispatches');
  const inputPat = document.getElementById('adminAttPatients');
  const inputNote = document.getElementById('adminAttNote');
  const btnDel = document.getElementById('btnAdminAttDeleteCurrent');

  if (recordId) {
    const att = attendance.find(a => a.id === recordId);
    if (!att) return;
    if (title) title.textContent = `👮‍♂️ 警消承辦人 - 編輯協勤簽到退紀錄`;
    if (inputId) inputId.value = att.id;
    if (selectMem) {
      const memObj = members.find(m => m.name === att.memberName) || members.find(m => m.id === att.memberId);
      selectMem.value = memObj ? memObj.id : (members[0]?.id || 'm1');
    }
    if (inputDate) inputDate.value = att.date || '115-10-07';
    if (inputSignIn) inputSignIn.value = att.signIn || '18:00';
    if (inputSignOut) inputSignOut.value = att.signOut || '23:00';
    if (inputHours) inputHours.value = att.hours != null ? att.hours : 5.0;
    if (inputDisp) inputDisp.value = att.dispatches != null ? att.dispatches : 0;
    if (inputPat) inputPat.value = att.patients != null ? att.patients : 0;
    if (inputNote) inputNote.value = att.note || '';
    if (btnDel) {
      btnDel.style.display = 'inline-block';
      btnDel.onclick = () => {
        deleteAttendanceRecord(att.id);
        modal.classList.remove('open');
      };
    }
  } else {
    // 新增手動補建模式
    if (title) title.textContent = `👮‍♂️ 警消承辦人 - 補建/代登協勤簽到退紀錄`;
    if (inputId) inputId.value = '';
    if (selectMem) selectMem.value = members[1]?.id || members[0]?.id || 'm1';
    if (inputDate) inputDate.value = CURRENT_SYSTEM_DATE || '115-10-07';
    if (inputSignIn) inputSignIn.value = '18:00';
    if (inputSignOut) inputSignOut.value = '23:00';
    if (inputHours) inputHours.value = 5.0;
    if (inputDisp) inputDisp.value = 2;
    if (inputPat) inputPat.value = 2;
    if (inputNote) inputNote.value = '警消承辦人手動補登協勤';
    if (btnDel) btnDel.style.display = 'none';
  }

  modal.classList.add('open');
}

function deleteAttendanceRecord(id) {
  const att = attendance.find(a => a.id === id);
  if (!att) return;
  const ok = confirm(`⚠️【警消最高權限・刪除確認】\n您確定要刪除【${att.memberName}】於 ${att.date} 的協勤簽到退紀錄嗎？\n\n（時數：${att.hours}hr ｜ 出勤：${att.dispatches}趟）\n刪除後將重新計算全月總時數與誤餐費。`);
  if (!ok) return;

  attendance = attendance.filter(a => a.id !== id);
  Store.set('attendance', attendance);
  updateAllViews();
  showToast(`已成功刪除該筆協勤打卡紀錄！`, '🗑️');
  playFeedbackSound('success');
}

function openAdminEditMemberModal(memberId) {
  const mem = members.find(m => m.id === memberId);
  if (!mem) return;
  const modal = document.getElementById('modalAdminEditMember');
  if (!modal) return;

  document.getElementById('adminMemberId').value = mem.id;
  document.getElementById('adminMemberName').value = mem.name;
  document.getElementById('adminMemberIdNo').value = mem.idNo || '';
  document.getElementById('adminMemberLevel').value = mem.level || 'EMT-2';
  document.getElementById('adminMemberRole').value = mem.role || '救護義消隊員';
  document.getElementById('adminMemberPhone').value = mem.phone || '';
  document.getElementById('adminMemberTotalHours').value = mem.totalHours != null ? mem.totalHours : 0;
  document.getElementById('adminMemberTotalDispatches').value = mem.totalDispatches != null ? mem.totalDispatches : 0;
  document.getElementById('adminMemberRoscCount').value = mem.roscCount != null ? mem.roscCount : 0;
  document.getElementById('adminMemberEcgCount').value = mem.ecgCount != null ? mem.ecgCount : 0;
  document.getElementById('adminMemberRestricted').value = mem.isRestricted ? 'true' : 'false';
  document.getElementById('adminMemberRestrictionUntil').value = mem.restrictionUntil || '';
  document.getElementById('adminMemberMakeupStatus').value = mem.makeupTrainingStatus || 'eligible';

  modal.classList.add('open');
}

function openEditDispatchModal(id) {
  const d = dispatches.find(item => item.id === id);
  if (!d) return;

  if (!canEditDispatch(d)) {
    showToast('權限受限：只有本次出勤之義消同仁或分隊長官具備修改此紀錄之權限！', '🔒');
    playFeedbackSound('alert');
    return;
  }

  const modal = document.getElementById('modalNewDispatch');
  if (!modal) return;
  modal.setAttribute('data-edit-id', d.id);
  
  const title = modal.querySelector('h3');
  if (title) title.textContent = `✏️ 編輯救護出勤紀錄 (${d.caseNo})`;

  if (document.getElementById('inputDispatchDate')) {
    document.getElementById('inputDispatchDate').value = d.date || getCurrentRocDate();
  }
  document.getElementById('inputCaseNo').value = d.caseNo;
  document.getElementById('inputVehicle').value = d.vehicle || '博館91';
  document.getElementById('inputDepartureTime').value = normalizeTimeStr(d.departureTime) || '20:00';
  document.getElementById('inputReturnTime').value = normalizeTimeStr(d.returnTime) || '21:10';
  document.getElementById('inputLocation').value = d.location || '';
  currentDispatchSelectedMembers = (d.memberNames || []).map(name => members.find(m => m.name === name)).filter(Boolean);
  initDispatchMemberSelect();
  renderDispatchMemberChips();
  // renderDispatchQuickMemberChips(); (已依需求移除)
  document.getElementById('inputResultType').value = d.resultType || '送醫';
  const patInput = document.getElementById('inputPatientCount');
  if (patInput) {
    patInput.value = (d.patientCount !== undefined && d.patientCount !== null) ? d.patientCount : (d.isIdle ? 0 : 1);
  }
  const hospSelect = document.getElementById('inputHospital');
  if (hospSelect) {
    const isNoHosp = !d.hospital || d.hospital === '無' || d.isIdle || (d.resultType && (d.resultType.includes('空跑') || d.resultType === '拒送'));
    if (isNoHosp) {
      hospSelect.value = '';
    } else {
      const rawHosp = d.hospital || '中國附醫';
      let matchedOpt = Array.from(hospSelect.options).find(opt => opt.value === rawHosp);
      if (!matchedOpt && rawHosp.includes('中國')) matchedOpt = Array.from(hospSelect.options).find(opt => opt.value === '中國附醫');
      if (!matchedOpt && rawHosp.includes('林新')) matchedOpt = Array.from(hospSelect.options).find(opt => opt.value.includes('林新'));
      if (!matchedOpt && rawHosp.includes('澄清')) matchedOpt = Array.from(hospSelect.options).find(opt => opt.value.includes('澄清'));
      if (!matchedOpt && rawHosp.includes('榮總')) matchedOpt = Array.from(hospSelect.options).find(opt => opt.value === '台中榮總');
      hospSelect.value = matchedOpt ? matchedOpt.value : (rawHosp || '中國附醫');
    }
  }
  document.getElementById('inputComplaint').value = d.chiefComplaint || '';

  // checkboxes
  document.querySelectorAll('input[name="treatment"]').forEach(cb => {
    cb.checked = d.treatments && d.treatments.includes(cb.value);
  });

  modal.classList.add('open');
}

function deleteDispatchRecord(id) {
  const d = dispatches.find(item => item.id === id);
  if (!d) return;
  const ok = confirm(`⚠️【警消最高權限・刪除出勤確認】\n案號：${d.caseNo} (${d.vehicle})\n出勤義消：${d.memberNames.join('、')}\n地點：${d.location}\n\n確定要刪除這筆救護出勤紀錄嗎？`);
  if (!ok) return;

  dispatches = dispatches.filter(item => item.id !== id);
  Store.set('dispatches', dispatches);
  deleteDispatchFromSupabase(id);
  updateAllViews();
  notifyCrossTabSync();
  showToast(`已刪除救護出勤紀錄案號 ${d.caseNo}！`, '🗑️');
  playFeedbackSound('success');
}


// ==============================================================================
// 救護出勤同仁多選管理系統 (Multi-Member Dispatch Selection & Sync)
// ==============================================================================

let currentDispatchSelectedMembers = [];

function renderDispatchMemberChips() {
  const container = document.getElementById('dispatchSelectedMembersChips');
  const countBadge = document.getElementById('dispatchSelectedCountBadge');
  if (!container) return;

  if (currentDispatchSelectedMembers.length === 0) {
    container.innerHTML = '<span style="color: var(--text-dim); font-size: 0.78rem;">尚未選擇義消（請由下方快速點選或下拉選取同仁隨車出勤）</span>';
  } else {
    container.innerHTML = currentDispatchSelectedMembers.map(m => `
      <span class="selected-member-chip">
        <span>👨‍🚒 ${m.name}</span>
        <span style="font-size: 0.7rem; opacity: 0.85; font-weight: normal;">(${m.level || 'EMT'})</span>
        <button type="button" class="btn-remove-chip" data-remove-dispatch-member="${m.name}" title="移除此位出勤同仁">&times;</button>
      </span>
    `).join('');

    container.querySelectorAll('[data-remove-dispatch-member]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const nameToRemove = btn.getAttribute('data-remove-dispatch-member');
        currentDispatchSelectedMembers = currentDispatchSelectedMembers.filter(m => m.name !== nameToRemove);
        renderDispatchMemberChips();
        // renderDispatchQuickMemberChips(); (已依需求移除)
      });
    });
  }

  if (countBadge) {
    const count = currentDispatchSelectedMembers.length;
    countBadge.textContent = `已選擇 ${count} 人`;
    countBadge.style.color = count > 0 ? '#38bdf8' : 'var(--text-muted)';
  }
}

function renderDispatchQuickMemberChips() {
  const quickContainer = document.getElementById('dispatchQuickMemberChips');
  if (!quickContainer) return;

  const candidateNames = new Set();
  if (activeDuty && activeDuty.memberName) candidateNames.add(activeDuty.memberName);
  
  const cur = getCurrentMember();
  if (cur && cur.name !== '未登入' && cur.id !== 'm0') candidateNames.add(cur.name);

  const todayShifts = shifts.filter(s => s.date === getCurrentRocDate() && s.memberName);
  todayShifts.forEach(s => candidateNames.add(s.memberName));

  ['盧秋如', '曾子庭', '林立強', '鄭暐勲', '洪銘聰'].forEach(n => candidateNames.add(n));

  const candidates = Array.from(candidateNames)
    .map(n => members.find(m => m.name === n))
    .filter(Boolean)
    .slice(0, 8);

  quickContainer.innerHTML = candidates.map(m => {
    const isSelected = currentDispatchSelectedMembers.some(sm => sm.name === m.name);
    return `
      <button type="button" class="login-chip-btn ${isSelected ? 'active' : ''}" data-quick-member="${m.name}" style="${isSelected ? 'background: rgba(56,189,248,0.25); border-color: #38bdf8; color: #38bdf8;' : ''}">
        ${isSelected ? '✓ ' : '+ '}${m.name} (${m.level || 'EMT'})
      </button>
    `;
  }).join('');

  quickContainer.querySelectorAll('[data-quick-member]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const name = btn.getAttribute('data-quick-member');
      const mem = members.find(m => m.name === name);
      if (!mem) return;

      const exists = currentDispatchSelectedMembers.some(m => m.name === name);
      if (exists) {
        currentDispatchSelectedMembers = currentDispatchSelectedMembers.filter(m => m.name !== name);
      } else {
        currentDispatchSelectedMembers.push(mem);
      }
      renderDispatchMemberChips();
      // renderDispatchQuickMemberChips(); (已依需求移除)
    });
  });
}

function initDispatchMemberSelect() {
  const select = document.getElementById('inputDispatchMemberSelect');
  if (!select) return;
  select.innerHTML = '<option value="">➕ 點此選擇出勤同仁...</option>';

  const groups = {
    'cadre': { label: '🏛️ 分隊幹部', el: document.createElement('optgroup') },
    'squad1': { label: '🚒 第一小隊', el: document.createElement('optgroup') },
    'squad2': { label: '🚒 第二小隊', el: document.createElement('optgroup') },
    'squad3': { label: '🚒 第三小隊', el: document.createElement('optgroup') },
    'central': { label: '🚒 中區小隊', el: document.createElement('optgroup') }
  };
  Object.values(groups).forEach(g => g.el.label = g.label);

  members.forEach(m => {
    if (m.id === 'm0') return;
    const opt = document.createElement('option');
    opt.value = m.name;
    opt.textContent = `${m.name} (${m.level || 'EMT'}) - ${m.squad || ''}`;

    if (m.squad === '分隊幹部') groups.cadre.el.appendChild(opt);
    else if (m.squad === '第一小隊') groups.squad1.el.appendChild(opt);
    else if (m.squad === '第二小隊') groups.squad2.el.appendChild(opt);
    else if (m.squad === '第三小隊') groups.squad3.el.appendChild(opt);
    else groups.central.el.appendChild(opt);
  });

  Object.values(groups).forEach(g => {
    if (g.el.children.length > 0) select.appendChild(g.el);
  });



  if (!select._bound) {
    select._bound = true;
    select.addEventListener('change', () => {
      const selectedName = select.value;
      if (!selectedName) return;
      const mem = members.find(m => m.name === selectedName);
      if (!mem) return;
      if (currentDispatchSelectedMembers.some(m => m.name === selectedName)) {
        showToast(`【${selectedName}】已在出勤名單中！`, '⚠️');
        select.value = '';
        return;
      }
      currentDispatchSelectedMembers.push(mem);
      select.value = '';
      renderDispatchMemberChips();
      // renderDispatchQuickMemberChips(); (已依需求移除)
    });
  }
}

function setupModals() {
  const modalDispatch = document.getElementById('modalNewDispatch');
  const modalClaim = document.getElementById('modalClaimShift');

  // 全站 24 小時制輸入框防呆與自動格式化掛載
  attachTime24hFormatters();

  // 開啟出勤 Modal (重設為新增狀態)
  function openCreateDispatchModal() {
    if (!isLoggedIn()) {
      showToast('請先登入義消隊員或承辦人帳號！', '⚠️');
      document.getElementById('modalLogin')?.classList.add('open');
      return;
    }
    modalDispatch.removeAttribute('data-edit-id');
    const title = modalDispatch.querySelector('h3');
    if (title) title.textContent = '🚑 登記救護出勤紀錄';
    
    const curRocDate = getCurrentRocDate();
    const dateNoDashes = curRocDate.replace(/-/g, '');
    const todaysDispCount = dispatches.filter(d => normalizeRocDateStr(d.date) === normalizeRocDateStr(curRocDate)).length + 1;
    document.getElementById('inputCaseNo').value = `${dateNoDashes}-${String(todaysDispCount).padStart(2, '0')}`;
    if (document.getElementById('inputDispatchDate')) {
      document.getElementById('inputDispatchDate').value = curRocDate;
    }
    document.getElementById('inputVehicle').value = '博館91';
    
    // 預設當前 24 小時制時間
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const depTime24 = `${hh}:${mm}`;
    const retDate = new Date(now.getTime() + 45 * 60 * 1000);
    const retTime24 = `${String(retDate.getHours()).padStart(2, '0')}:${String(retDate.getMinutes()).padStart(2, '0')}`;
    const inDep = document.getElementById('inputDepartureTime');
    const inRet = document.getElementById('inputReturnTime');
    if (inDep) inDep.value = depTime24;
    if (inRet) inRet.value = retTime24;

    document.getElementById('inputResultType').value = '送醫';
    document.getElementById('inputHospital').value = '';
    const patInput = document.getElementById('inputPatientCount');
    if (patInput) patInput.value = '1';
    document.getElementById('inputComplaint').value = '';
    
    // 處置項目預設全部不勾選
    document.querySelectorAll('input[name="treatment"]').forEach(cb => {
      cb.checked = false;
    });

    currentDispatchSelectedMembers = [];
    const cur = getCurrentMember();
    if (cur && cur.name !== '未登入' && cur.id !== 'm0') {
      currentDispatchSelectedMembers.push(cur);
    }
    initDispatchMemberSelect();
    renderDispatchMemberChips();
    // renderDispatchQuickMemberChips(); (已依需求移除)
    modalDispatch.classList.add('open');
  }

  // 監聽送醫結果狀態：若為空跑、拒送，自動將送往醫院清為空值
  const inputResultType = document.getElementById('inputResultType');
  const inputHospital = document.getElementById('inputHospital');
  const inputPatientCount = document.getElementById('inputPatientCount');
  if (inputResultType && !inputResultType._boundChange) {
    inputResultType._boundChange = true;
    inputResultType.addEventListener('change', () => {
      const val = inputResultType.value;
      if (val.includes('空跑')) {
        if (inputHospital) inputHospital.value = '';
        if (inputPatientCount) inputPatientCount.value = '0';
      } else if (val === '拒送') {
        if (inputHospital) inputHospital.value = '';
        if (inputPatientCount && (inputPatientCount.value === '0' || !inputPatientCount.value)) {
          inputPatientCount.value = '1';
        }
      } else {
        // 送醫：人數預設1人，醫院保留使用者填選狀態（預設空白）
        if (inputPatientCount && (inputPatientCount.value === '0' || !inputPatientCount.value)) {
          inputPatientCount.value = '1';
        }
      }
    });
  }

  document.getElementById('btnOpenNewDispatchModal')?.addEventListener('click', openCreateDispatchModal);
  document.getElementById('btnNewDispatchHeader')?.addEventListener('click', openCreateDispatchModal);

  // 更新排班 Modal 內的個人額度即時提示
  function updateModalQuotaPreview(targetMem) {
    const quotaNotice = document.getElementById('modalQuotaNotice');
    if (!quotaNotice) return;

    if (isSuperAdmin()) {
      quotaNotice.style.background = 'rgba(245,158,11,0.2)';
      quotaNotice.style.borderColor = '#f59e0b';
      quotaNotice.style.color = '#fbbf24';
      quotaNotice.innerHTML = `👑 <strong>警消承辦人最高管理特權</strong>：不受 3 班上限與處分限制，可任意指定排班或調度`;
      return;
    }

    const futureShifts = getMemberFutureShifts(targetMem.name);
    const count = futureShifts.length;
    const isRestricted = !!targetMem.isRestricted;

    if (isRestricted) {
      quotaNotice.style.background = 'rgba(239,68,68,0.15)';
      quotaNotice.style.borderColor = 'rgba(239,68,68,0.4)';
      quotaNotice.style.color = '#f87171';
      quotaNotice.innerHTML = `⛔ 管制中（至 ${targetMem.restrictionUntil || '115-12-07'} 止）｜ 僅限小隊幹部代填班表`;
    } else if (count >= 3) {
      quotaNotice.style.background = 'rgba(245,158,11,0.15)';
      quotaNotice.style.borderColor = 'rgba(245,158,11,0.4)';
      quotaNotice.style.color = '#fbbf24';
      quotaNotice.innerHTML = `⚠️ 額度已滿（3/3 班）｜ 需協勤完一班後方可再往後填寫`;
    } else {
      quotaNotice.style.background = 'rgba(16,185,129,0.12)';
      quotaNotice.style.borderColor = 'rgba(16,185,129,0.3)';
      quotaNotice.style.color = '#34d399';
      quotaNotice.innerHTML = `✅ 目前預約：${count} / 3 班 ｜ 本次尚可預約 ${3 - count} 班`;
    }
  }
  window.updateModalQuotaPreview = updateModalQuotaPreview;

  // 即時計算並更新排班 Modal 內的時段席位儀表 (先填先站位即時回饋)
  function updateClaimModalSlotMeter() {
    const date = document.getElementById('inputShiftDate')?.value;
    const catVal = document.getElementById('inputShiftCategory')?.value;
    const period = document.getElementById('inputShiftPeriod')?.value;
    const descEl = document.getElementById('modalSlotLiveStatusDesc');
    const badgeEl = document.getElementById('modalSlotLiveStatusBadge');
    const submitBtn = document.getElementById('btnSubmitClaimShift');
    if (!date || !period || !badgeEl) return;

    const isDesk = catVal && catVal.includes('值班');
    const status = getSlotCapacityStatus(date, period);

    if (isDesk) {
      if (status.deskFull) {
        if (descEl) {
          descEl.textContent = `該時段協勤值班已有同仁站位（${status.deskOccupants.map(s => s.memberName).join('、')}）！依規定一個時段僅限 1 位，請選擇其他時段。`;
          descEl.style.color = '#f87171';
        }
        badgeEl.className = 'capacity-pill full';
        badgeEl.textContent = '🔴 值班已額滿 (1/1)';
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.style.opacity = '0.5';
        }
      } else {
        if (descEl) {
          descEl.textContent = `協勤值班開放站位中（限額 1 位）。採先填先站位原則，送出即可成功卡位！`;
          descEl.style.color = '#34d399';
        }
        badgeEl.className = 'capacity-pill available';
        badgeEl.textContent = '🟢 尚可站位 (0/1)';
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.style.opacity = '1';
        }
      }
    } else {
      if (status.emsFull) {
        if (descEl) {
          descEl.textContent = `該時段協勤救護已達 4 位上限（已站位：${status.emsOccupants.map(s => s.memberName).join('、')}）！採先填先站位原則，已無法再登記。`;
          descEl.style.color = '#f87171';
        }
        badgeEl.className = 'capacity-pill full';
        badgeEl.textContent = '🔴 救護已額滿 (4/4)';
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.style.opacity = '0.5';
        }
      } else {
        if (descEl) {
          descEl.textContent = `協勤救護目前 ${status.emsOccupants.length}/4 位站位（尚餘 ${status.emsAvailable} 席開放）。採先填先站位原則，送出即可立即卡位！`;
          descEl.style.color = '#38bdf8';
        }
        badgeEl.className = 'capacity-pill available';
        badgeEl.textContent = `🟢 尚餘 ${status.emsAvailable} 席 (可站位)`;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.style.opacity = '1';
        }
      }
    }
  }

  // 簡約手動輸入起訖時間核心邏輯
  const inStart = document.getElementById('inputShiftStartTime');
  const inEnd = document.getElementById('inputShiftEndTime');
  const hiddenPeriod = document.getElementById('inputShiftPeriod');
  const badgeDuration = document.getElementById('shiftDurationBadge');
  const textSummary = document.getElementById('shiftPeriodSummaryText');
  const badgeLive = document.getElementById('modalSlotLiveStatusBadge');
  const submitBtn = document.getElementById('btnSubmitClaimShift');

  function normalizeTimeStr(tStr) {
    if (!tStr) return '';
    const s = cleanFlexibleTimeStr(tStr);
    if (s.includes(':')) {
      const [h, m] = s.split(':').map(Number);
      if (!isNaN(h)) {
        return `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
      }
    }
    if (/^\d{4}$/.test(s)) {
      return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
    }
    if (/^\d{3}$/.test(s)) {
      return `0${s.slice(0, 1)}:${s.slice(1, 3)}`;
    }
    if (/^\d{1,2}$/.test(s)) {
      return `${String(Number(s)).padStart(2, '0')}:00`;
    }
    return s;
  }

  function updateFlexibleTimeInputs(autoFormat = false) {
    if (!inStart || !inEnd) return;

    if (autoFormat) {
      if (inStart.value) inStart.value = normalizeTimeStr(inStart.value);
      if (inEnd.value) inEnd.value = normalizeTimeStr(inEnd.value);
    }

    const sVal = inStart.value.trim();
    const eVal = inEnd.value.trim();
    const parsed = parseTimePeriod(`${sVal}-${eVal}`);

    if (parsed.valid) {
      const dur = (parsed.endMin - parsed.startMin) / 60;
      if (badgeDuration) badgeDuration.textContent = `${dur.toFixed(1)} 小時`;
      if (textSummary) textSummary.textContent = `(${parsed.formatted})`;
      if (hiddenPeriod) hiddenPeriod.value = parsed.formatted;

      if (parsed.startMin < 7 * 60 || parsed.endMin > 23 * 60) {
        if (badgeLive) {
          badgeLive.className = 'capacity-pill full';
          badgeLive.textContent = '限 07:00~23:00';
        }
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.style.opacity = '0.5';
        }
      } else {
        updateClaimModalSlotMeter();
      }
    } else {
      if (badgeDuration) badgeDuration.textContent = `請輸入正確時間`;
      if (textSummary) textSummary.textContent = ``;
      if (badgeLive) {
        badgeLive.className = 'capacity-pill full';
        badgeLive.textContent = '時間不符';
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.5';
      }
    }
  }

  // 全域時段設定工具
  window.syncFlexiblePeriodInputs = function(start, end) {
    if (inStart && start) inStart.value = normalizeTimeStr(start);
    if (inEnd && end) inEnd.value = normalizeTimeStr(end);
    updateFlexibleTimeInputs(true);
  };

  inStart?.addEventListener('input', () => updateFlexibleTimeInputs(false));
  inStart?.addEventListener('blur', () => updateFlexibleTimeInputs(true));
  inEnd?.addEventListener('input', () => updateFlexibleTimeInputs(false));
  inEnd?.addEventListener('blur', () => updateFlexibleTimeInputs(true));

  // 預設填入 09:00 與 15:00
  if (inStart && !inStart.value) inStart.value = '09:00';
  if (inEnd && !inEnd.value) inEnd.value = '15:00';
  updateFlexibleTimeInputs(true);

  // 監聽勤務類別變更 (連動補定訓警語與預設值)
  const selectCat = document.getElementById('inputShiftCategory');
  const alertMakeup = document.getElementById('makeupTrainingAlertBox');
  const selectType = document.getElementById('inputShiftType');

  selectCat?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val.includes('補定訓')) {
      if (alertMakeup) alertMakeup.style.display = 'block';
      if (selectType) selectType.value = '補定訓';
      window.syncFlexiblePeriodInputs('18:00', '22:00');
    } else {
      if (alertMakeup) alertMakeup.style.display = 'none';
      if (selectType) selectType.value = val.includes('值班') ? '幹部值班' : '自排班';
    }
    updateFlexibleTimeInputs(true);
  });

  document.getElementById('inputShiftDate')?.addEventListener('change', () => updateFlexibleTimeInputs(false));

  // 監聽警消指派隊員選單變更
  document.getElementById('selectShiftMemberAdmin')?.addEventListener('change', (e) => {
    const m = members.find(item => item.name === e.target.value) || getCurrentMember();
    updateModalQuotaPreview(m);
  });

  // 開啟認領 Modal (附帶資格預檢)
  function openClaimModalWithCheck(isProxy = false, proxyMemberName = null) {
    const cur = getCurrentMember();
    const isOfficer = isCurrentOfficer();
    const isAdm = isSuperAdmin();
    let targetMem = cur;

    const grpNormal = document.getElementById('groupShiftMemberNormal');
    const grpAdmin = document.getElementById('groupShiftMemberAdmin');
    const selectAdmin = document.getElementById('selectShiftMemberAdmin');

    if (isAdm) {
      if (grpNormal) grpNormal.style.display = 'none';
      if (grpAdmin) grpAdmin.style.display = 'block';
      if (selectAdmin) {
        if (proxyMemberName) {
          selectAdmin.value = proxyMemberName;
        } else if (!selectAdmin.value) {
          selectAdmin.value = cur.name;
        }
        targetMem = members.find(m => m.name === selectAdmin.value) || cur;
      }
      modalClaim.setAttribute('data-officer-proxy', 'true');
    } else {
      if (grpNormal) grpNormal.style.display = 'block';
      if (grpAdmin) grpAdmin.style.display = 'none';

      if (isProxy && proxyMemberName) {
        targetMem = members.find(m => m.name === proxyMemberName) || cur;
        modalClaim.setAttribute('data-officer-proxy', 'true');
      } else {
        modalClaim.removeAttribute('data-officer-proxy');
        if (cur.isRestricted && !isOfficer) {
          alert(
            `⛔【處分管制中・禁止自行填班】\n隊員：${cur.name}\n管制期限：至 ${cur.restrictionUntil || '115-12-07'} 止（自處分日起2個月）\n\n處分原因：超過三班且屬故意累犯，依規定「無法自行填班，需透過小隊幹部填寫班表」！\n\n⚠️ 重大警告：管制期內如自行填班，將提請幹部會議依《義勇消防組織編組訓練演習服勤辦法》第八條第一項第7款予以解聘！`
          );
          return;
        }
        const futureShifts = getMemberFutureShifts(cur.name);
        if (futureShifts.length >= 3 && !isOfficer) {
          alert(
            `⚠️【預約額度已達上限】\n每位同仁每次預約上限最多 3 班（含跨月）！\n您目前已有 3 班未協勤班次，需待協勤完畢一班後，方可再往後填寫！`
          );
          return;
        }
      }
    }

    document.getElementById('inputShiftMemberName').value = targetMem.name;
    updateModalQuotaPreview(targetMem);
    if (typeof updateFlexibleTimeInputs === 'function') updateFlexibleTimeInputs(true);
    modalClaim.classList.add('open');
    updateClaimModalSlotMeter();
  }

  document.getElementById('btnOpenClaimShiftModal')?.addEventListener('click', () => {
    openClaimModalWithCheck(false);
  });

  document.getElementById('btnQuickClaimVacant')?.addEventListener('click', () => {
    openClaimModalWithCheck(false);
  });

  // 關閉 Modal
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modalId = btn.getAttribute('data-close-modal');
      document.getElementById(modalId)?.classList.remove('open');
      if (modalId === 'modalClaimShift') {
        modalClaim.removeAttribute('data-officer-proxy');
      }
    });
  });

  // 點選遮罩背景關閉彈窗 (行動裝置友善防呆)
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('open');
        if (overlay.id === 'modalClaimShift') {
          modalClaim.removeAttribute('data-officer-proxy');
        }
      }
    });
  });

  // 監聽所有彈窗與抽屜開關，強制同步 display none / flex，杜絕手機端 backdrop-filter 黑色遮罩殘影
  const allOverlays = document.querySelectorAll('.modal-overlay, .mobile-more-drawer-overlay');
  const overlayObserver = new MutationObserver(() => {
    allOverlays.forEach(el => {
      if (el.classList.contains('open')) {
        el.style.display = 'flex';
      } else {
        el.style.display = 'none';
      }
    });
    const hasOpenOverlay = document.querySelector('.modal-overlay.open, .mobile-more-drawer-overlay.open');
    if (hasOpenOverlay) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
  });

  allOverlays.forEach(el => {
    if (!el.classList.contains('open')) {
      el.style.display = 'none';
    }
    overlayObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
  });

  // 表單 1: 登記或修改出勤案件
  document.getElementById('formNewDispatch')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const caseNo = document.getElementById('inputCaseNo').value;
    const vehicle = document.getElementById('inputVehicle').value;
    const departureTime = normalizeTimeStr(document.getElementById('inputDepartureTime').value) || '20:00';
    const returnTime = normalizeTimeStr(document.getElementById('inputReturnTime').value) || '21:10';
    const location = document.getElementById('inputLocation').value;
    if (currentDispatchSelectedMembers.length === 0) {
      showToast('請至少選擇一位出勤義消同仁！', '⚠️');
      playFeedbackSound('alert');
      return;
    }
    const memberNames = currentDispatchSelectedMembers.map(m => m.name);
    const memberIds = currentDispatchSelectedMembers.map(m => m.id);
    const resultType = document.getElementById('inputResultType').value;
    let hospital = document.getElementById('inputHospital').value;
    const chiefComplaint = document.getElementById('inputComplaint').value;

    const treatments = [];
    document.querySelectorAll('input[name="treatment"]:checked').forEach(cb => {
      treatments.push(cb.value);
    });

    const isRosc = resultType.includes('ROSC');
    const isIdle = resultType.includes('空跑');
    const isRefused = resultType === '拒送';

    // 送醫結果如果是空跑、拒送，送往醫院變成空值
    if (isIdle || isRefused) {
      hospital = '';
    }

    const patInput = document.getElementById('inputPatientCount');
    let patientCount = patInput ? parseInt(patInput.value, 10) : (isIdle ? 0 : 1);
    if (isNaN(patientCount) || patientCount < 0) {
      patientCount = isIdle ? 0 : 1;
    }

    const dispatchDate = document.getElementById('inputDispatchDate')?.value.trim() || getCurrentRocDate();

    const editId = modalDispatch.getAttribute('data-edit-id');
    if (editId) {
      // 警消或出勤隊員編輯修改既有出勤紀錄 (限制僅出勤同仁可修改)
      const idx = dispatches.findIndex(d => d.id === editId);
      if (idx !== -1) {
        if (!canEditDispatch(dispatches[idx])) {
          showToast('權限受限：只有本次出勤之義消同仁或分隊長官具備修改此紀錄之權限！', '🔒');
          playFeedbackSound('alert');
          modalDispatch.classList.remove('open');
          modalDispatch.removeAttribute('data-edit-id');
          return;
        }
        dispatches[idx] = {
          ...dispatches[idx],
          caseNo,
          date: dispatchDate,
          vehicle,
          departureTime,
          returnTime,
          location,
          memberNames,
          memberIds,
          resultType,
          patientCount,
          isIdle,
          treatments,
          chiefComplaint,
          hospital: (isIdle || isRefused) ? '' : (hospital || '無'),
          isSpecial: isRosc || treatments.includes('12導程心電圖'),
          specialTag: isRosc ? '🌟 ROSC 急救成功' : (treatments.includes('12導程心電圖') ? '📈 12-Lead ECG 傳輸' : '')
        };
      }
      modalDispatch.removeAttribute('data-edit-id');
      const title = modalDispatch.querySelector('h3');
      if (title) title.textContent = '🚑 登記救護出勤紀錄';
      Store.set('dispatches', dispatches);
      pushDispatchToSupabase(dispatches[idx]);
      modalDispatch.classList.remove('open');
      updateAllViews();
      playFeedbackSound('success');
      notifyCrossTabSync();
      showToast(`救護出勤案號 ${caseNo} 資料已成功更新！`, '💾');
      return;
    }

    const newDisp = {
      id: `disp-${Date.now()}`,
      caseNo,
      date: dispatchDate,
      vehicle,
      departureTime,
      returnTime,
      location,
      memberIds,
      memberNames,
      resultType,
      patientCount,
      isIdle,
      treatments,
      chiefComplaint,
      hospital: (isIdle || isRefused) ? '' : (hospital || '無'),
      isSpecial: isRosc || treatments.includes('12導程心電圖'),
      specialTag: isRosc ? '🌟 ROSC 急救成功' : (treatments.includes('12導程心電圖') ? '📈 12-Lead ECG 傳輸' : '')
    };

    dispatches.unshift(newDisp);
    Store.set('dispatches', dispatches);
    pushDispatchToSupabase(newDisp);

    // 1. 同步升級所有出勤同仁數據 (全員同步累加榮譽履歷)
    currentDispatchSelectedMembers.forEach(targetMem => {
      const mem = members.find(m => m.name === targetMem.name || m.id === targetMem.id);
      if (mem) {
        mem.totalDispatches = (Number(mem.totalDispatches) || 0) + 1;
        if (isRosc) mem.roscCount = (Number(mem.roscCount) || 0) + 1;
        if (treatments.includes('12導程心電圖')) mem.ecgCount = (Number(mem.ecgCount) || 0) + 1;
        if (treatments.includes('靜脈注射')) mem.ivCount = (Number(mem.ivCount) || 0) + 1;
      }
    });
    Store.set('members', members);

    // 2. 自動連動出勤同仁當日在隊簽到記錄 (累加出勤趟數與服務人次)
    let attendanceUpdated = false;
    currentDispatchSelectedMembers.forEach(targetMem => {
      const attRecord = attendance.find(a => 
        (a.memberId === targetMem.id || a.memberName === targetMem.name) && 
        normalizeRocDateStr(a.date) === normalizeRocDateStr(dispatchDate)
      );
      if (attRecord) {
        attRecord.dispatches = (Number(attRecord.dispatches) || 0) + 1;
        attRecord.patients = (Number(attRecord.patients) || 0) + patientCount;
        pushAttendanceToSupabase(attRecord);
        attendanceUpdated = true;
      }
    });
    if (attendanceUpdated) {
      Store.set('attendance', attendance);
    }

    modalDispatch.classList.remove('open');
    updateAllViews();
    playFeedbackSound('success');
    notifyCrossTabSync();
    showToast(`救護出勤案號 ${caseNo} 登記完成！已同步認列【${memberNames.join('、')}】共 ${memberNames.length} 位同仁之救護履歷！`, '🚑');
  });

  // 表單 2: 自排班登記 (嚴格套用所有排班法規驗證，警消可指定任何隊員)
  document.getElementById('formClaimShift')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!isLoggedIn()) {
      showToast('請先登入義消同仁帳號方可預定排班！', '⚠️');
      document.getElementById('modalLogin')?.classList.add('open');
      return;
    }
    const date = document.getElementById('inputShiftDate').value;
    const catVal = document.getElementById('inputShiftCategory').value;
    const rawPeriod = document.getElementById('inputShiftPeriod').value.trim();
    const parsedTime = parseTimePeriod(rawPeriod);
    if (!parsedTime.valid) {
      alert(`⚠️【時段格式錯誤】\n您輸入的時段為：「${rawPeriod}」\n\n支援格式範例：\n• 09-15 (表示 09:00 至 15:00)\n• 07-15\n• 17-22\n• 09:30-15:00\n請確認開始時間早於結束時間！`);
      playFeedbackSound('alert');
      return;
    }
    const period = parsedTime.formatted;
    const shiftType = document.getElementById('inputShiftType').value;
    
    let memberName = document.getElementById('inputShiftMemberName').value;
    if (isSuperAdmin()) {
      const selectAdmin = document.getElementById('selectShiftMemberAdmin');
      if (selectAdmin && selectAdmin.value) {
        memberName = selectAdmin.value;
      }
    }
    const isProxy = modalClaim.getAttribute('data-officer-proxy') === 'true' || isSuperAdmin();

    // 依據類別映射車輛與值班台標籤
    let vehicle = '救護協勤';
    if (catVal === '值班台_一般') vehicle = '值班台';
    else if (catVal === '值班台_補定訓') vehicle = '值班台 (補定訓)';

    const targetMember = members.find(m => m.name === memberName) || getCurrentMember();

    // 進行四大鐵律與容量法規檢驗
    const validation = validateShiftBooking(targetMember, date, vehicle, period, shiftType, null, isProxy);

    if (!validation.ok) {
      alert(validation.reason);
      playFeedbackSound('alert');
      return;
    }

    const dayNum = Number(date.split('-')[2]) || 1;
    const dateParts = date.split('-');
    const gregYear = Number(dateParts[0]) + 1911;
    const mIdx = Number(dateParts[1]) - 1;
    const dVal = Number(dateParts[2]);
    const weekdayName = ['日', '一', '二', '三', '四', '五', '六'][new Date(gregYear, mIdx, dVal).getDay()];

    // 尋找此時段是否有現成空缺 (例如突發取消釋出之班次)，若有則直接認領
    let existingVacant = shifts.find(s => s.date === date && s.period === period && (!s.memberName || s.status === '缺協勤') && (vehicle.includes('值班') ? s.vehicle.includes('值班') : !s.vehicle.includes('值班')));

    if (existingVacant) {
      existingVacant.memberName = targetMember.name;
      existingVacant.status = '已排班';
      existingVacant.shiftType = shiftType;
      existingVacant.isMakeupTraining = catVal.includes('補定訓');
      pushShiftToSupabase(existingVacant);
    } else {
      const newShift = {
        id: `s-${Date.now()}`,
        date,
        day: dayNum,
        dayOfWeek: weekdayName,
        vehicle,
        period,
        memberName: targetMember.name,
        status: '已排班',
        shiftType,
        isMakeupTraining: catVal.includes('補定訓')
      };
      shifts.push(newShift);
      pushShiftToSupabase(newShift);
    }

    Store.set('shifts', shifts);

    modalClaim.removeAttribute('data-officer-proxy');
    modalClaim.classList.remove('open');
    updateAllViews();
    playFeedbackSound('success');
    showToast(`⚡ 先填先站位成功！${targetMember.name} 於 ${date} (${vehicle} ${period}) 已完成登記`, '🎉');
  });

  // 表單 2.5: 遇突發狀況取消預定 (即刻釋出席位)
  document.getElementById('formCancelShift')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const shiftId = document.getElementById('cancelModalShiftId').value;
    const reasonCategory = document.getElementById('cancelReasonCategory').value;
    const reasonNote = document.getElementById('cancelReasonNote').value.trim();
    executeEmergencyCancel(shiftId, reasonCategory, reasonNote);
  });

  // 警消最高權限 - 補建協勤打卡按鈕
  document.getElementById('btnAdminAddAttendance')?.addEventListener('click', () => {
    openAdminEditAttendanceModal(null);
  });

  // 警消最高權限 - 自動試算在隊時數
  document.getElementById('btnAdminAttCalcHours')?.addEventListener('click', () => {
    const sIn = normalizeTimeStr(document.getElementById('adminAttSignIn').value);
    const sOut = normalizeTimeStr(document.getElementById('adminAttSignOut').value);
    if (!sIn || !sOut) return;
    const [h1, m1] = sIn.split(':').map(Number);
    const [h2, m2] = sOut.split(':').map(Number);
    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (diff < 0) diff += 24 * 60;
    const calc = Math.max(0, Math.round((diff / 60) * 10) / 10);
    document.getElementById('adminAttHours').value = calc;
    showToast(`自動試算時數：${calc} 小時`, '⏱️');
  });

  // 警消最高權限 - 儲存協勤簽到退紀錄 (新增或修改)
  document.getElementById('formAdminEditAttendance')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('adminAttRecordId').value;
    const memberId = document.getElementById('adminAttMemberSelect').value;
    const mem = members.find(m => m.id === memberId) || members[0];
    const date = document.getElementById('adminAttDate').value.trim();
    const signIn = normalizeTimeStr(document.getElementById('adminAttSignIn').value) || '18:00';
    const signOut = normalizeTimeStr(document.getElementById('adminAttSignOut').value) || '23:00';
    const hours = parseFloat(document.getElementById('adminAttHours').value) || 0;
    const dispatchesCount = parseInt(document.getElementById('adminAttDispatches').value, 10) || 0;
    const patientsCount = parseInt(document.getElementById('adminAttPatients').value, 10) || 0;
    const note = document.getElementById('adminAttNote').value.trim();

    if (id) {
      const idx = attendance.findIndex(a => a.id === id);
      if (idx !== -1) {
        attendance[idx] = {
          ...attendance[idx],
          memberId: mem.id,
          memberName: mem.name,
          date,
          signIn,
          signOut,
          hours,
          dispatches: dispatchesCount,
          patients: patientsCount,
          note: note || '救護協勤'
        };
      }
      showToast(`已成功覆寫更新【${mem.name}】於 ${date} 的協勤簽到退紀錄！`, '💾');
    } else {
      const newAtt = {
        id: `att-${Date.now()}`,
        memberId: mem.id,
        memberName: mem.name,
        date,
        signIn,
        signOut,
        hours,
        dispatches: dispatchesCount,
        patients: patientsCount,
        note: note || '警消手動補建協勤'
      };
      attendance.unshift(newAtt);
      showToast(`已成功手動補建【${mem.name}】於 ${date} 的協勤出入紀錄！`, '➕');
    }

    Store.set('attendance', attendance);
    document.getElementById('modalAdminEditAttendance')?.classList.remove('open');
    updateAllViews();
    playFeedbackSound('success');
  });

  // 警消最高權限 - 儲存隊員檔案與成效數據
  document.getElementById('formAdminEditMember')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('adminMemberId').value;
    const mem = members.find(m => m.id === id);
    if (!mem) return;

    mem.name = document.getElementById('adminMemberName').value.trim();
    mem.idNo = document.getElementById('adminMemberIdNo').value.trim();
    mem.level = document.getElementById('adminMemberLevel').value;
    mem.role = document.getElementById('adminMemberRole').value;
    mem.phone = document.getElementById('adminMemberPhone').value.trim();
    mem.totalHours = parseFloat(document.getElementById('adminMemberTotalHours').value) || 0;
    mem.totalDispatches = parseInt(document.getElementById('adminMemberTotalDispatches').value, 10) || 0;
    mem.roscCount = parseInt(document.getElementById('adminMemberRoscCount').value, 10) || 0;
    mem.ecgCount = parseInt(document.getElementById('adminMemberEcgCount').value, 10) || 0;
    mem.isRestricted = document.getElementById('adminMemberRestricted').value === 'true';
    mem.restrictionUntil = mem.isRestricted ? (document.getElementById('adminMemberRestrictionUntil').value.trim() || '115-12-07') : null;
    mem.makeupTrainingStatus = document.getElementById('adminMemberMakeupStatus').value;

    Store.set('members', members);
    initMemberSelector();
    document.getElementById('modalAdminEditMember')?.classList.remove('open');
    updateAllViews();
    showToast(`已成功覆寫更新隊員【${mem.name}】檔案資料與管制狀態！`, '👮‍♂️');
    playFeedbackSound('success');
  });

  // Modal 4: Supabase 雲端資料庫設定
  const modalSupa = document.getElementById('modalSupabaseConfig');
  document.getElementById('btnOpenSupabaseModal')?.addEventListener('click', () => {
    const inputUrl = document.getElementById('inputSupabaseUrl');
    const inputKey = document.getElementById('inputSupabaseKey');
    if (inputUrl) inputUrl.value = SUPABASE_CONFIG.url || '';
    if (inputKey) inputKey.value = SUPABASE_CONFIG.key || '';
    updateCloudIndicator(!!supabaseClient);
    modalSupa?.classList.add('open');
  });

  document.getElementById('formSupabaseConfig')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = document.getElementById('inputSupabaseUrl').value.trim();
    const key = document.getElementById('inputSupabaseKey').value.trim();
    Store.set('supabase_url', url);
    Store.set('supabase_key', key);
    SUPABASE_CONFIG.url = url;
    SUPABASE_CONFIG.key = key;

    const ok = initSupabase();
    if (ok) {
      showToast('已成功連線至 Supabase 雲端資料庫！全隊即時同步中', '🚀');
      playFeedbackSound('success');
    } else {
      showToast('已儲存設定，若金鑰無誤重整頁面即可連線', 'ℹ️');
    }
    modalSupa?.classList.remove('open');
  });

  document.getElementById('btnCopySchemaSqlFromModal')?.addEventListener('click', () => {
    fetch('supabase_schema.sql')
      .then(res => res.text())
      .then(sql => {
        navigator.clipboard.writeText(sql).then(() => {
          showToast('已複製 Supabase 完整建表 SQL 腳本！請至 Supabase SQL Editor 貼上執行', '📋');
        });
      })
      .catch(() => {
        showToast('請直接開啟專案目錄中的 supabase_schema.sql 複製', '📄');
      });
  });

  document.getElementById('btnResetToLocalMode')?.addEventListener('click', () => {
    Store.set('supabase_url', '');
    Store.set('supabase_key', '');
    SUPABASE_CONFIG.url = '';
    SUPABASE_CONFIG.key = '';
    supabaseClient = null;
    const inputUrl = document.getElementById('inputSupabaseUrl');
    const inputKey = document.getElementById('inputSupabaseKey');
    if (inputUrl) inputUrl.value = '';
    if (inputKey) inputKey.value = '';
    updateCloudIndicator(false);
    showToast('已切換回本地暫存模式 (LocalStorage)', '🔄');
  });
}

// ==========================================
// 6. 消防署業務檢查要求資料輸出 (SheetJS)
// ==========================================
function setupExcelExport() {
  // 格式 1: 消防署【救災救護派遣／義消資訊系統】備勤協勤人員清單匯入
  document.getElementById('btnExportNfaFormat1')?.addEventListener('click', () => {
    try {
      if (typeof XLSX === 'undefined') {
        alert('正在加載 Excel 匯出模組，請稍候重試');
        return;
      }
      const wb = XLSX.utils.book_new();

      // Sheet 1: 範例
      const sheet1Data = [
        [
          '協勤種類\n(*請填寫協勤/備勤/演習)',
          '服勤類別\n(*請參考第二頁籤服勤類別名稱)',
          '事件日期\n(*填寫案件日期，範例:113-08-31，如無請自行新增)',
          '事件名稱\n(*1.填寫案件名稱，範例:測試案件，如無請自行新增；\n2.事件名稱前請增加分隊名稱，如 :XX分隊_XX月待命協勤)',
          '事件地點\n(*請填寫包含縣市鄉鎮)',
          '簽到日期(起)\n(*範例:113-08-31)',
          '簽到時間(起)\n(*範例:08:00)',
          '簽到日期(迄)\n(*範例:113-08-31)',
          '簽到時間(迄)\n(*範例:17:00)',
          '身分證字號\n'
        ]
      ];

      // 1. 寫入在隊待命協勤
      attendance.forEach(att => {
        const mem = members.find(m => m.name === att.memberName) || {};
        const idNo = mem.idNo || 'L123668055';
        const signInTime = att.signIn.length === 5 ? `${att.signIn}:00` : att.signIn;
        const signOutTime = (att.signOut && att.signOut.length === 5) ? `${att.signOut}:00` : (att.signOut || '23:00:00');

        sheet1Data.push([
          '備勤',
          '待命協勤',
          att.date,
          '博館分隊10月待命協勤',
          '臺中市北區台灣大道二段350號',
          att.date,
          signInTime,
          att.date,
          signOutTime,
          idNo
        ]);
      });

      // 2. 寫入救護出勤紀錄 (協勤)
      dispatches.forEach(disp => {
        disp.memberNames.forEach(mName => {
          const mem = members.find(m => m.name === mName) || {};
          const idNo = mem.idNo || 'L123668055';
          const depTime = disp.departureTime.length === 5 ? `${disp.departureTime}:00` : disp.departureTime;
          const retTime = disp.returnTime.length === 5 ? `${disp.returnTime}:00` : disp.returnTime;
          const cat = disp.chiefComplaint && disp.chiefComplaint.includes('車') ? '緊急救護-車禍' : '緊急救護-急病';

          sheet1Data.push([
            '協勤',
            cat,
            disp.date,
            `${disp.vehicle}救護出勤_${disp.caseNo}`,
            disp.location,
            disp.date,
            depTime,
            disp.date,
            retTime,
            idNo
          ]);
        });
      });

      const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
      XLSX.utils.book_append_sheet(wb, ws1, '範例');

      // Sheet 2: 服勤類別清單
      const sheet2Data = [
        ['服勤名稱'],
        ['待命協勤'],
        ['緊急救護-急病'],
        ['緊急救護-車禍'],
        ['火災搶救-建築物'],
        ['災害搶救-風災'],
        ['水域救援-水災'],
        ['防溺宣導'],
        ['防火宣導']
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
      XLSX.utils.book_append_sheet(wb, ws2, '服勤類別');

      XLSX.writeFile(wb, '115年10月_博館分隊_備勤協勤人員清單匯入(消防署格式).xlsx');
      showToast('消防署【備勤協勤人員清單】匯入檔已成功產生！', '🚒');
      playFeedbackSound('success');
    } catch (err) {
      console.error(err);
      alert('匯出失敗：' + err.message);
    }
  });

  // 格式 2: 衛福部／消防署【志願服務整合資訊系統】服務時數紀錄批次匯入
  document.getElementById('btnExportNfaFormat2')?.addEventListener('click', () => {
    try {
      if (typeof XLSX === 'undefined') {
        alert('正在加載 Excel 匯出模組，請稍候重試');
        return;
      }
      const wb = XLSX.utils.book_new();

      // Sheet 1: 服務時數記錄
      const sheet1Data = [
        ['姓名', '身分證字號', '服務日期起', '服務日期迄', '服務項目', '服務內容', '服務時數-小時', '服務時數-分鐘', '受服務人次', '交通費', '誤餐費', '服務區域', '備註', '匯入動作', '序號']
      ];

      members.forEach((m) => {
        const memberAtt = attendance.filter(a => a.memberName === m.name && a.date.startsWith('115-10'));
        const totalHours = memberAtt.reduce((sum, a) => sum + (Number(a.hours) || 0), 0);
        const hPart = totalHours > 0 ? Math.floor(totalHours) : '';
        const mPart = totalHours > 0 ? Math.round((totalHours - Math.floor(totalHours)) * 60) : '';
        const totalPatients = memberAtt.reduce((sum, a) => sum + (Number(a.patients) || 0), 0);
        const mealTimes = memberAtt.filter(a => Number(a.hours) >= 4).length;
        const mealAmount = mealTimes * 100;

        sheet1Data.push([
          m.name,
          m.idNo || '',
          '1151001',
          '1151031',
          '0190', // 消防防救災服務代碼
          '0099', // 其他
          hPart,
          mPart === 0 ? '' : mPart,
          totalPatients || '',
          '0',
          mealAmount,
          'B', // 臺中市
          '',
          'A', // 新增
          ''
        ]);
      });

      const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
      XLSX.utils.book_append_sheet(wb, ws1, '服務時數記錄');

      // Sheet 2: 服務項目代碼
      const wsCodes1 = XLSX.utils.aoa_to_sheet([
        ['代碼', '名稱'],
        ['0010', '綜合服務'],
        ['0190', '消防防救災服務']
      ]);
      XLSX.utils.book_append_sheet(wb, wsCodes1, '服務項目代碼');

      // Sheet 3: 服務內容代碼
      const wsCodes2 = XLSX.utils.aoa_to_sheet([
        ['代碼', '名稱'],
        ['0001', '居家(在宅)服務'],
        ['0099', '其他']
      ]);
      XLSX.utils.book_append_sheet(wb, wsCodes2, '服務內容代碼');

      // Sheet 4: 服務區域代碼
      const wsCodes3 = XLSX.utils.aoa_to_sheet([
        ['代碼', '名稱'],
        ['', '中央'],
        ['A', '台北市'],
        ['B', '台中市'],
        ['F', '新北市']
      ]);
      XLSX.utils.book_append_sheet(wb, wsCodes3, '服務區域代碼');

      XLSX.writeFile(wb, '115年10月_博館分隊_服務時數紀錄(志願服務整合系統格式).xlsx');
      showToast('志願服務整合系統【服務時數紀錄】匯入檔已成功產生！', '🏥');
      playFeedbackSound('success');
    } catch (err) {
      console.error(err);
      alert('匯出失敗：' + err.message);
    }
  });

  // 格式 3: 分隊公文簽到與救護出勤彙整清冊 (自用月報)
  document.getElementById('btnExportOfficialExcel')?.addEventListener('click', () => {
    try {
      if (typeof XLSX === 'undefined') {
        alert('正在加載 Excel 匯出模組，請稍候重試');
        return;
      }

      const wb = XLSX.utils.book_new();

      // 分頁 1: 簽到簽退總表與誤餐費清冊
      const sheet1Data = [
        ['臺中市政府消防局救護義消 鳳凰救護大隊博館分隊 協勤簽到簽退與誤餐費清冊'],
        ['統計月份：民國115年10月', '', '', '', '匯出日期：民國115年10月07日'],
        ['編號', '義消姓名', '身分證字號', '等級職稱', '協勤天數(次)', '協勤總時數(hr)', '出勤趟數', '服務人次', '符合誤餐費次數', '預估誤餐費金額($100/次)']
      ];

      members.forEach((m, idx) => {
        const memberAtt = attendance.filter(a => a.memberName === m.name && a.date.startsWith('115-10'));
        const days = memberAtt.length;
        const hours = memberAtt.reduce((sum, a) => sum + (Number(a.hours) || 0), 0);
        const dispatchesCount = memberAtt.reduce((sum, a) => sum + (Number(a.dispatches) || 0), 0);
        const patientsCount = memberAtt.reduce((sum, a) => sum + (Number(a.patients) || 0), 0);
        const mealTimes = memberAtt.filter(a => Number(a.hours) >= 4).length;
        const mealAmount = mealTimes * 100;

        sheet1Data.push([
          idx + 1,
          m.name,
          m.idNo || '',
          `${m.level} (${m.role})`,
          days,
          hours.toFixed(1),
          dispatchesCount,
          patientsCount,
          mealTimes,
          mealAmount
        ]);
      });

      const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
      XLSX.utils.book_append_sheet(wb, ws1, '簽到簽退與誤餐費總表');

      // 分頁 2: 救護出勤明細紀錄表 (對應官方出勤紀錄格式)
      const sheet2Data = [
        ['臺中市政府消防局救護義消參與緊急救護出勤紀錄表 (博館分隊)'],
        ['序號', '救護案號', '出勤日期', '車輛', '出勤時間', '返隊時間', '出勤地點', '出勤義消', '處置項目', '結果類型', '送往醫院']
      ];

      dispatches.forEach((d, idx) => {
        sheet2Data.push([
          idx + 1,
          d.caseNo,
          d.date,
          d.vehicle,
          d.departureTime,
          d.returnTime,
          d.location,
          d.memberNames.join('、'),
          d.treatments.join(', '),
          d.resultType,
          d.hospital
        ]);
      });

      const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
      XLSX.utils.book_append_sheet(wb, ws2, '救護出勤紀錄明細表');

      // 產生並下載檔案
      XLSX.writeFile(wb, '115年10月_博館分隊救護義消協勤與出勤月報表.xlsx');
      showToast('標準公文月報 Excel 檔案已成功產生並下載！', '📥');
      playFeedbackSound('success');
    } catch (err) {
      console.error(err);
      alert('匯出 Excel 時發生錯誤：' + err.message);
    }
  });

  // 列印按鈕
  document.getElementById('btnPrintReport')?.addEventListener('click', () => {
    window.print();
  });
}

// ==========================================
// 7. 視角切換器 (手機模擬 vs 電腦視窗)
// ==========================================
function setupDeviceToggle() {
  const btn = document.getElementById('btnToggleDevice');
  const main = document.getElementById('mainContainer');

  btn.addEventListener('click', () => {
    main.classList.toggle('phone-mode');
    const isPhone = main.classList.contains('phone-mode');
    btn.innerHTML = isPhone ? '<span>🖥️ 切換電腦模式</span>' : '<span>📱 切換手機模式</span>';
    showToast(isPhone ? '已切換為「義消手機模擬視角」' : '已切換為「電腦全螢幕後台視角」', '🔄');
  });
}

// ==========================================
// 8. 頁籤切換 (Tabs & Mobile Bottom Nav)
// ==========================================
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const bottomNavItems = document.querySelectorAll('.bottom-nav-item[data-tab]');


  // 同步底部導覽列 Active 狀態
  function syncBottomNavActive(targetTab) {
    let matched = false;
    bottomNavItems.forEach(item => {
      if (item.getAttribute('data-tab') === targetTab) {
        item.classList.add('active');
        matched = true;
      } else {
        item.classList.remove('active');
      }
    });


  }

  // 頂部最新公告橫幅點擊直達「分隊公告」分頁
  document.getElementById('btnScrollToAnnouncements')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelector('.tab-btn[data-tab="tab-announcements"]')?.click();
  });
  document.getElementById('topAnnouncementAlert')?.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') {
      document.querySelector('.tab-btn[data-tab="tab-announcements"]')?.click();
    }
  });

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // 讓當前選中的頁籤在水平滑動列中自動置中
      btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

      // 切換頁籤時自動平滑回頂部，免去手動滑上滑下
      window.scrollTo({ top: 0, behavior: 'smooth' });

      const targetTab = btn.getAttribute('data-tab');
      window.location.hash = targetTab;
      document.querySelectorAll('.tab-content').forEach(c => {
        c.style.display = 'none';
        c.classList.remove('active');
      });

      const activeContent = document.getElementById(targetTab);
      if (activeContent) {
        activeContent.style.display = 'block';
        activeContent.classList.add('active');
      }

      if (targetTab === 'tab-officer-dashboard') {
        renderOfficerExecutiveDashboard();
      }

      // 同步底部快捷導覽列
      syncBottomNavActive(targetTab);
    });
  });

  // 手機底部導覽列點擊切換
  bottomNavItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');
      const targetBtn = document.querySelector(`.tab-btn[data-tab="${targetTab}"]`);
      if (targetBtn) {
        targetBtn.click();
      }
    });
  });



  // 支援網址直接帶入 Hash (例如: #tab-schedule 或 #tab-badges) 直接開啟對應分頁
  function switchTabByHash() {
    const rawHash = window.location.hash.replace('#', '').trim();
    if (rawHash) {
      const targetBtn = document.querySelector(`.tab-btn[data-tab="${rawHash}"]`);
      if (targetBtn && !targetBtn.classList.contains('active')) {
        targetBtn.click();
      }
    } else {
      // 預設為協勤打卡
      syncBottomNavActive('tab-checkin');
    }
  }

  switchTabByHash();
  window.addEventListener('hashchange', switchTabByHash);

  // 篩選輸入事件
  document.getElementById('searchDispatchInput')?.addEventListener('input', renderDispatchList);
  document.getElementById('filterVehicleSelect')?.addEventListener('change', renderDispatchList);
  document.getElementById('filterTagSelect')?.addEventListener('change', renderDispatchList);

  // 複製 Supabase SQL 腳本按鈕
  document.getElementById('btnCopySqlSchema')?.addEventListener('click', () => {
    fetch('supabase_schema.sql')
      .then(res => res.text())
      .then(sql => {
        navigator.clipboard.writeText(sql).then(() => {
          showToast('已複製 Supabase 完整 SQL Schema 到剪貼簿！', '📋');
        });
      })
      .catch(() => {
        showToast('請直接開啟 supabase_schema.sql 檔案查看', '📄');
      });
  });
}

// ==========================================

// ==========================================
// 8.5. 義消人員名單管理模組 (Roster Module)
// ==========================================
let rosterFilterState = {
  search: '',
  squad: 'all',
  cert: 'all',
  status: 'active', // 'active' | 'all' | 'retired'
  viewMode: 'cards' // 'cards' | 'table'
};

// 讓 HTML 內能呼叫直接切換同仁
window.switchMemberDirectly = function(targetMemberId) {
  const target = members.find(m => m.id === targetMemberId);
  if (!target) return;
  currentMemberId = target.id;
  Store.set('currentMemberId', currentMemberId);
  
  // 更新 navbar 的下拉選單值
  const sel = document.getElementById('memberSelect');
  if (sel) sel.value = target.id;
  
  updateAllViews();
  const isAdm = isSuperAdmin();
  showToast(isAdm ? '已切換至【分隊警消承辦人】最高全域管理模式' : `已切換登入身分為：${target.name} (${target.level})`, isAdm ? '👮‍♂️' : '👤');
};

// 開啟新增隊員彈窗
window.openAddMemberModal = function() {
  const modal = document.getElementById('modalMemberEdit');
  if (!modal) return;
  const icon = document.getElementById('modalMemberEditIcon');
  const title = document.getElementById('modalMemberEditTitle');
  if (icon) icon.textContent = '➕';
  if (title) title.textContent = '新增義消隊員';

  document.getElementById('inputMemberEditId').value = '';
  document.getElementById('inputMemberName').value = '';
  document.getElementById('inputMemberIdNo').value = '';
  document.getElementById('inputMemberSquad').value = '第一小隊';
  document.getElementById('inputMemberSquadRole').value = '隊員';
  document.getElementById('inputMemberLevel').value = 'EMT-2';
  document.getElementById('inputMemberJoined').value = `${getCurrentRocDate().split('-')[0]}年${Number(getCurrentRocDate().split('-')[1])}月`;
  document.getElementById('inputMemberPhone').value = '';
  document.getElementById('inputMemberAvatar').value = '👨‍🚒';

  modal.classList.add('open');
};

// 開啟編輯隊員彈窗
window.openEditMemberModal = function(id) {
  const mem = members.find(m => m.id === id);
  if (!mem) return;
  const modal = document.getElementById('modalMemberEdit');
  if (!modal) return;
  const icon = document.getElementById('modalMemberEditIcon');
  const title = document.getElementById('modalMemberEditTitle');
  if (icon) icon.textContent = '✏️';
  if (title) title.textContent = `編輯義消同仁資料 - ${mem.name}`;

  document.getElementById('inputMemberEditId').value = mem.id;
  document.getElementById('inputMemberName').value = mem.name;
  document.getElementById('inputMemberIdNo').value = mem.idNo || '';
  document.getElementById('inputMemberSquad').value = mem.squad || '第一小隊';
  document.getElementById('inputMemberSquadRole').value = mem.squadRole || '隊員';
  document.getElementById('inputMemberLevel').value = mem.level || 'EMT-2';
  document.getElementById('inputMemberJoined').value = mem.joined || '';
  document.getElementById('inputMemberPhone').value = mem.phone || '';
  document.getElementById('inputMemberAvatar').value = mem.avatar || '👨‍🚒';

  modal.classList.add('open');
};

// 開啟退隊封存彈窗
window.openRetireMemberModal = function(id) {
  const mem = members.find(m => m.id === id);
  if (!mem) return;
  const modal = document.getElementById('modalMemberRetire');
  if (!modal) return;

  document.getElementById('inputRetireMemberId').value = mem.id;
  const nameDisp = document.getElementById('retireMemberNameDisplay');
  if (nameDisp) nameDisp.textContent = `${mem.name} (${mem.squad || ''}・${mem.squadRole || '隊員'})`;

  document.getElementById('inputRetireDate').value = getCurrentRocDate();
  document.getElementById('inputRetireReason').value = '生涯規劃';
  document.getElementById('inputRetireNote').value = '';

  modal.classList.add('open');
};

// 恢復退隊隊員為現職
window.restoreMember = function(id) {
  const mem = members.find(m => m.id === id);
  if (!mem) return;
  if (!confirm(`確定要將【${mem.name}】恢復為「現職在隊」狀態嗎？\n恢復後該員將重新出現在各項日常排班與出勤選單中。`)) return;

  mem.status = 'active';
  mem.retiredDate = null;
  mem.retiredReason = '';
  Store.set('members', members);
  updateAllViews();
  playFeedbackSound('success');
  showToast(`已成功將【${mem.name}】恢復為現職在隊同仁！`, '✅');
};

function renderRosterView() {
  const cardsContainer = document.getElementById('rosterCardsContainer');
  const tableContainer = document.getElementById('rosterTableContainer');
  const tbody = document.getElementById('rosterTableTbody');
  if (!cardsContainer) return;

  const isAdm = isSuperAdmin();

  // 取得除了 m0 承辦人以外的所有義消同仁
  const volunteerList = members.filter(m => m.id !== 'm0' && !m.role.includes('警消'));

  // 進行篩選
  const query = (rosterFilterState.search || '').trim().toLowerCase();
  const filtered = volunteerList.filter(m => {
    // 搜尋比對 (姓名, 證照, 小隊, 職位)
    if (query) {
      const matchName = m.name.toLowerCase().includes(query);
      const matchLevel = (m.level || '').toLowerCase().includes(query) || (m.levelCode || '').toLowerCase().includes(query);
      const matchSquad = (m.squad || '').toLowerCase().includes(query);
      const matchRole = (m.squadRole || '').toLowerCase().includes(query) || (m.role || '').toLowerCase().includes(query);
      if (!matchName && !matchLevel && !matchSquad && !matchRole) return false;
    }

    // 小隊篩選
    if (rosterFilterState.squad !== 'all') {
      if (m.squad !== rosterFilterState.squad) return false;
    }

    // 證照篩選
    if (rosterFilterState.cert !== 'all') {
      if (rosterFilterState.cert === 'TP' && m.levelCode !== 'TP' && !m.level.includes('TP')) return false;
      if (rosterFilterState.cert === 'T2' && m.levelCode !== 'T2' && !m.level.includes('EMT-2')) return false;
      if (rosterFilterState.cert === 'T1' && m.levelCode !== 'T1' && !m.level.includes('EMT-1')) return false;
      if (rosterFilterState.cert === '待訓' && m.levelCode !== '待訓' && !m.level.includes('待訓')) return false;
    }

    // 在隊狀態篩選 (現職在隊 / 全部名冊 / 退隊封存)
    if (rosterFilterState.status === 'active') {
      if (m.status === 'retired') return false;
    } else if (rosterFilterState.status === 'retired') {
      if (m.status !== 'retired') return false;
    }

    return true;
  });

  // 更新頂部各統計徽章計數
  const countActive = volunteerList.filter(m => m.status !== 'retired').length;
  const countRetired = volunteerList.filter(m => m.status === 'retired').length;
  const countTotalAll = volunteerList.length;

  const countCadre = volunteerList.filter(m => m.squad === '分隊幹部' && m.status !== 'retired').length;
  const countSquad1 = volunteerList.filter(m => m.squad === '第一小隊' && m.status !== 'retired').length;
  const countSquad2 = volunteerList.filter(m => m.squad === '第二小隊' && m.status !== 'retired').length;
  const countSquad3 = volunteerList.filter(m => m.squad === '第三小隊' && m.status !== 'retired').length;
  const countCentral = volunteerList.filter(m => m.squad === '中區' && m.status !== 'retired').length;

  const setElText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setElText('countChipAll', countActive);
  setElText('countChipCadre', countCadre);
  setElText('countChipSquad1', countSquad1);
  setElText('countChipSquad2', countSquad2);
  setElText('countChipSquad3', countSquad3);
  setElText('countChipCentral', countCentral);

  setElText('countChipActive', countActive);
  setElText('countChipTotalAll', countTotalAll);
  setElText('countChipRetired', countRetired);
  setElText('rosterStatTotal', `${countActive} 人`);

  // 1. 卡片檢視渲染
  if (rosterFilterState.viewMode === 'cards') {
    cardsContainer.style.display = 'block';
    if (tableContainer) tableContainer.style.display = 'none';

    if (filtered.length === 0) {
      cardsContainer.innerHTML = `
        <div class="glass-card" style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🔍</div>
          <div style="font-size: 1.1rem; font-weight: 700; color: #f8fafc;">查無符合條件的義消同仁</div>
          <p style="font-size: 0.85rem; margin-top: 0.25rem;">請嘗試調整搜尋關鍵字或切換狀態篩選條件</p>
        </div>
      `;
      return;
    }

    // 定義編制分組
    const squads = [
      { id: '分隊幹部', name: '分隊幹部', icon: '🏛️', isCadre: true, desc: '隊務策劃、協勤行政督導與救護品管核心' },
      { id: '第一小隊', name: '第一小隊', icon: '🚒', isCadre: false, desc: '第一救護協勤責任分組 (小隊長 鄭暐勲 / 副小隊長 洪銘聰)' },
      { id: '第二小隊', name: '第二小隊', icon: '🚒', isCadre: false, desc: '第二救護協勤責任分組 (小隊長 李忠南 / 副小隊長 謝易庭)' },
      { id: '第三小隊', name: '第三小隊', icon: '🚒', isCadre: false, desc: '第三救護協勤責任分組 (小隊長 曾子庭 / 副小隊長 林立強)' },
      { id: '中區',     name: '中區',     icon: '🚒', isCadre: false, desc: '中區責任責任編制救護同仁協勤組' }
    ];

    let html = '';

    squads.forEach(sq => {
      const squadMembers = filtered.filter(m => m.squad === sq.id);
      if (squadMembers.length === 0) return;

      squadMembers.sort((a, b) => {
        // 先排在隊現職，退隊排在後
        if (a.status !== b.status) {
          return a.status === 'retired' ? 1 : -1;
        }
        const order = { '小隊長': 1, '副小隊長': 2, '幹部': 3, '隊員': 4 };
        const oa = order[a.squadRole] || 5;
        const ob = order[b.squadRole] || 5;
        return oa - ob;
      });

      html += `
        <div class="roster-squad-section ${sq.isCadre ? 'cadre-section' : ''}">
          <div class="roster-squad-header">
            <div class="roster-squad-title-group">
              <span class="roster-squad-icon">${sq.icon}</span>
              <div>
                <div class="roster-squad-title">${sq.name}</div>
                <div class="roster-squad-desc">${sq.desc}</div>
              </div>
            </div>
            <div class="roster-squad-badge">
              編制同仁 ${squadMembers.length} 人
            </div>
          </div>

          <div class="roster-cards-grid">
            ${squadMembers.map(m => renderMemberCardHtml(m, isAdm)).join('')}
          </div>
        </div>
      `;
    });

    cardsContainer.innerHTML = html;
  } else {
    // 2. 表格檢視渲染
    cardsContainer.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'block';

    if (tbody) {
      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 2.5rem;">查無符合條件之人員</td></tr>';
        return;
      }

      tbody.innerHTML = filtered.map((m, idx) => {
        const isCur = m.id === currentMemberId;
        const isRetired = m.status === 'retired';
        return `
          <tr style="${isCur ? 'background: rgba(6,182,212,0.1); font-weight: 700;' : ''} ${isRetired ? 'opacity: 0.75;' : ''}">
            <td style="color: var(--text-dim); text-align: center;">${idx + 1}</td>
            <td>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="font-size: 1.2rem;">${m.avatar}</span>
                <span style="font-weight: 700; color: #f8fafc;">${m.name}</span>
                ${isRetired ? '<span style="font-size: 0.68rem; background: rgba(239,68,68,0.25); color: #fca5a5; padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(239,68,68,0.4);">已退隊</span>' : ''}
                ${isCur ? '<span style="font-size: 0.7rem; background: #06b6d4; color: #000; padding: 1px 6px; border-radius: 4px; font-weight: 800;">目前</span>' : ''}
              </div>
            </td>
            <td><span style="color: #38bdf8;">${m.squad || '-'}</span></td>
            <td>${renderRoleTagHtml(m)}</td>
            <td>${renderCertBadgeHtml(m)}</td>
            <td style="color: #34d399; font-weight: 700;">${(m.totalHours || 0).toFixed(1)} hr</td>
            <td style="font-weight: 700;">${m.totalDispatches || 0} 次</td>
            <td style="color: #ef4444; font-weight: 700;">${m.roscCount || 0} 例</td>
            <td style="color: #06b6d4;">${m.ecgCount || 0} 例</td>
            <td style="color: #c084fc;">${m.ivCount || 0} 例</td>
            <td style="text-align: center; white-space: nowrap;">
              ${isCur ? 
                '<span style="color: #34d399; font-size: 0.8rem;">● 登入中</span>' : 
                `<button type="button" class="btn-switch-member" style="padding: 3px 8px; font-size: 0.72rem;" onclick="switchMemberDirectly('${m.id}')">切換登入</button>`
              }
              ${isAdm ? `
                <div style="display: inline-flex; gap: 4px; margin-left: 6px;">
                  <button type="button" class="btn-sm-action" style="padding: 2px 7px; font-size: 0.72rem; color: #38bdf8; border: 1px solid rgba(56,189,248,0.3);" onclick="window.openEditMemberModal('${m.id}')" title="編輯隊員資料">
                    ✏️
                  </button>
                  ${isRetired ? `
                    <button type="button" class="btn-sm-action" style="padding: 2px 7px; font-size: 0.72rem; color: #34d399; border: 1px solid rgba(16,185,129,0.3);" onclick="window.restoreMember('${m.id}')" title="恢復在隊現職">
                      🔄 復隊
                    </button>
                  ` : `
                    <button type="button" class="btn-sm-action danger" style="padding: 2px 7px; font-size: 0.72rem; color: #f87171; border: 1px solid rgba(239,68,68,0.3);" onclick="window.openRetireMemberModal('${m.id}')" title="辦理退隊離隊封存">
                      🚪 退隊
                    </button>
                  `}
                </div>
              ` : ''}
            </td>
          </tr>
        `;
      }).join('');
    }
  }
}

function renderRoleTagHtml(m) {
  if (m.squadRole === '幹部') return '<span class="roster-role-tag cadre">🎖️ 幹部</span>';
  if (m.squadRole === '小隊長') return '<span class="roster-role-tag leader">⭐ 小隊長</span>';
  if (m.squadRole === '副小隊長') return '<span class="roster-role-tag deputy">🌟 副小隊長</span>';
  return '<span class="roster-role-tag member">隊員</span>';
}

function renderCertBadgeHtml(m) {
  const code = m.levelCode || '';
  if (code === 'TP' || m.level.includes('TP')) {
    return '<span class="cert-badge tp">🌟 EMT-P (TP)</span>';
  } else if (code === 'T2' || m.level.includes('EMT-2')) {
    return '<span class="cert-badge t2">🛡️ EMT-2 (中級)</span>';
  } else if (code === 'T1' || m.level.includes('EMT-1')) {
    return '<span class="cert-badge t1">🔰 EMT-1 (初級)</span>';
  } else {
    return '<span class="cert-badge pending">⏳ 待訓 / 新進</span>';
  }
}

function renderMemberCardHtml(m, isAdm = false) {
  const isCur = m.id === currentMemberId;
  const isRetired = m.status === 'retired';
  const isCadre = m.squadRole === '幹部';
  const isLeader = m.squadRole === '小隊長';
  const isDeputy = m.squadRole === '副小隊長';

  let cardClasses = 'roster-member-card';
  if (isCur) cardClasses += ' is-current';
  if (isCadre) cardClasses += ' cadre-card';
  if (isLeader) cardClasses += ' leader-card';
  if (isDeputy) cardClasses += ' deputy-card';
  if (isRetired) cardClasses += ' retired-card';

  let avatarGlow = '';
  if (isCadre) avatarGlow = 'glow-cadre';
  if (isLeader) avatarGlow = 'glow-leader';
  if (isDeputy) avatarGlow = 'glow-deputy';

  return `
    <div class="${cardClasses}" style="${isRetired ? 'opacity: 0.8; border-color: rgba(239,68,68,0.3);' : ''}">
      <div class="roster-card-top">
        <div class="roster-avatar ${avatarGlow}">
          ${m.avatar}
        </div>
        <div class="roster-name-group">
          <div class="roster-name-row">
            <span class="roster-name">${m.name}</span>
            ${isRetired ? 
              `<span class="roster-role-tag danger" style="background: rgba(239,68,68,0.2); color: #fca5a5; border: 1px solid rgba(239,68,68,0.4);">🚪 已退隊</span>` : 
              renderRoleTagHtml(m)
            }
          </div>
          <div style="font-size: 0.72rem; color: var(--text-dim); margin-top: 2px;">
            ${m.squad || ''}・資歷 ${m.joined || '博館分隊'}${isRetired && m.retiredDate ? ` (離隊：${m.retiredDate})` : ''}
          </div>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center;">
        ${renderCertBadgeHtml(m)}
        <span style="font-size: 0.72rem; color: var(--text-dim); font-family: monospace;">${m.phone || ''}</span>
      </div>

      <div class="roster-card-stats">
        <div class="roster-card-stat-item">
          <span>⏱️</span>
          <span><strong>${(m.totalHours || 0).toFixed(1)}</strong> hr</span>
        </div>
        <div class="roster-card-stat-item">
          <span>🚑</span>
          <span><strong>${m.totalDispatches || 0}</strong> 趟</span>
        </div>
        <div class="roster-card-stat-item" title="ROSC 現場急救成功心跳恢復">
          <span style="color: #f87171;">⚡</span>
          <span><strong>${m.roscCount || 0}</strong> ROSC</span>
        </div>
      </div>

      <div class="roster-card-actions" style="display: flex; flex-direction: column; gap: 0.45rem;">
        ${isCur ? 
          `<button type="button" class="btn-switch-member active-login" disabled>
              <span>✅ 目前已登入中</span>
            </button>` :
          `<button type="button" class="btn-switch-member" onclick="switchMemberDirectly('${m.id}')">
              <span>👤 切換由此人登入</span>
            </button>`
        }
        ${isAdm ? `
          <div style="display: flex; gap: 0.4rem; width: 100%; margin-top: 0.2rem;">
            <button type="button" class="btn-sm-action" style="flex: 1; justify-content: center; background: rgba(56,189,248,0.12); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); padding: 0.35rem 0.5rem; font-size: 0.75rem;" onclick="window.openEditMemberModal('${m.id}')">
              ✏️ 編輯
            </button>
            ${isRetired ? `
              <button type="button" class="btn-sm-action" style="flex: 1; justify-content: center; background: rgba(16,185,129,0.12); color: #34d399; border: 1px solid rgba(16,185,129,0.3); padding: 0.35rem 0.5rem; font-size: 0.75rem;" onclick="window.restoreMember('${m.id}')">
                🔄 恢復現職
              </button>
            ` : `
              <button type="button" class="btn-sm-action danger" style="flex: 1; justify-content: center; background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.3); padding: 0.35rem 0.5rem; font-size: 0.75rem;" onclick="window.openRetireMemberModal('${m.id}')">
                🚪 退隊
              </button>
            `}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function setupRosterControls() {
  // 1. 搜尋輸入監聽
  const searchInput = document.getElementById('inputRosterSearch');
  searchInput?.addEventListener('input', (e) => {
    rosterFilterState.search = e.target.value;
    renderRosterView();
  });

  // 2. 小隊篩選晶片
  document.querySelectorAll('.roster-chip[data-squad]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.roster-chip[data-squad]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rosterFilterState.squad = btn.getAttribute('data-squad');
      renderRosterView();
    });
  });

  // 3. 證照篩選晶片
  document.querySelectorAll('.roster-chip[data-cert]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.roster-chip[data-cert]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rosterFilterState.cert = btn.getAttribute('data-cert');
      renderRosterView();
    });
  });

  // 3.5 在隊狀態篩選晶片 (現職 / 全部 / 退隊)
  document.querySelectorAll('.roster-chip[data-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.roster-chip[data-status]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rosterFilterState.status = btn.getAttribute('data-status');
      renderRosterView();
    });
  });

  // 4. 檢視模式切換
  const btnCards = document.getElementById('btnRosterViewCards');
  const btnTable = document.getElementById('btnRosterViewTable');

  btnCards?.addEventListener('click', () => {
    btnCards.classList.add('active');
    btnTable?.classList.remove('active');
    rosterFilterState.viewMode = 'cards';
    renderRosterView();
  });

  btnTable?.addEventListener('click', () => {
    btnTable.classList.add('active');
    btnCards?.classList.remove('active');
    rosterFilterState.viewMode = 'table';
    renderRosterView();
  });

  // 5. 匯出 Excel
  document.getElementById('btnExportRosterExcel')?.addEventListener('click', exportRosterToExcel);

  // 6. 友善列印
  document.getElementById('btnPrintRoster')?.addEventListener('click', () => {
    window.print();
  });

  // 7. 承辦人新增義消隊員按鈕
  document.getElementById('btnOpenAddMemberModal')?.addEventListener('click', () => {
    openAddMemberModal();
  });

  // 8. 表單：新增 / 編輯義消隊員資料提交處理
  document.getElementById('formMemberEdit')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const editId = document.getElementById('inputMemberEditId').value;
    const name = document.getElementById('inputMemberName').value.trim();
    const idNo = document.getElementById('inputMemberIdNo').value.trim().toUpperCase();
    const squad = document.getElementById('inputMemberSquad').value;
    const squadRole = document.getElementById('inputMemberSquadRole').value;
    const level = document.getElementById('inputMemberLevel').value;
    const joined = document.getElementById('inputMemberJoined').value.trim();
    const phone = document.getElementById('inputMemberPhone').value.trim();
    const avatar = document.getElementById('inputMemberAvatar').value;

    let levelCode = 'T2';
    if (level.includes('TP')) levelCode = 'TP';
    else if (level.includes('EMT-2')) levelCode = 'T2';
    else if (level.includes('EMT-1')) levelCode = 'T1';
    else if (level.includes('待訓')) levelCode = '待訓';

    let role = squadRole !== '隊員' ? `${squadRole}` : `${squad}隊員`;
    if (squad === '分隊幹部') role = '救護義消幹部';

    if (editId) {
      // 編輯既有同仁
      const mem = members.find(m => m.id === editId);
      if (!mem) return;
      mem.name = name;
      mem.idNo = idNo;
      mem.squad = squad;
      mem.squadRole = squadRole;
      mem.role = role;
      mem.level = level;
      mem.levelCode = levelCode;
      mem.joined = joined;
      mem.phone = phone;
      mem.avatar = avatar;

      // 同步更新帳號庫中的姓名
      const allAccs = getUserAccounts();
      const userAcc = allAccs.find(a => a.memberId === mem.id);
      if (userAcc) {
        userAcc.name = name;
        userAcc.username = name;
        Store.set('user_accounts', allAccs);
      }

      Store.set('members', members);
      document.getElementById('modalMemberEdit')?.classList.remove('open');
      updateAllViews();
      playFeedbackSound('success');
      showToast(`隊員【${name}】資料已成功更新儲存！`, '💾');
    } else {
      // 新增隊員
      if (members.some(m => m.name === name)) {
        showToast(`編制名冊中已有同名義消【${name}】，請設定以茲區分之姓名！`, '⚠️');
        playFeedbackSound('alert');
        return;
      }

      const newId = `m-${Date.now()}`;
      const newMember = {
        id: newId,
        name,
        idNo,
        squad,
        squadRole,
        role,
        level,
        levelCode,
        avatar,
        phone,
        joined: joined || `${getCurrentRocDate().split('-')[0]}年${Number(getCurrentRocDate().split('-')[1])}月`,
        totalHours: 0.0,
        totalDispatches: 0,
        roscCount: 0,
        ecgCount: 0,
        ivCount: 0,
        isRestricted: false,
        restrictionUntil: null,
        makeupTrainingStatus: 'eligible',
        status: 'active',
        retiredDate: null,
        retiredReason: ''
      };

      members.push(newMember);
      Store.set('members', members);

      // 自動為該隊員建立帳號 (預設密碼 1234)
      getUserAccounts();

      document.getElementById('modalMemberEdit')?.classList.remove('open');
      updateAllViews();
      playFeedbackSound('success');
      showToast(`新進義消同仁【${name}】已成功加入編制名冊！\n登入帳號為「${name}」，預設密碼 1234`, '🎉');
    }
  });

  // 9. 表單：退隊封存處理
  document.getElementById('formMemberRetire')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const retireId = document.getElementById('inputRetireMemberId').value;
    const mem = members.find(m => m.id === retireId);
    if (!mem) return;

    const retireDate = document.getElementById('inputRetireDate').value.trim();
    const reason = document.getElementById('inputRetireReason').value;
    const note = document.getElementById('inputRetireNote').value.trim();

    mem.status = 'retired';
    mem.retiredDate = retireDate;
    mem.retiredReason = note ? `${reason} (${note})` : reason;

    Store.set('members', members);
    document.getElementById('modalMemberRetire')?.classList.remove('open');
    updateAllViews();
    playFeedbackSound('success');
    showToast(`已為【${mem.name}】辦理退隊離隊封存！該員已從日常排班及出勤登記排除，歷史紀錄維持完整。`, '🚪');
  });

  // 10. 徹底刪除人員 (測試帳號用)
  document.getElementById('btnDeleteMemberPermanently')?.addEventListener('click', () => {
    const retireId = document.getElementById('inputRetireMemberId').value;
    const mem = members.find(m => m.id === retireId);
    if (!mem) return;

    if (!confirm(`⚠️ 確定要徹底刪除【${mem.name}】嗎？\n此動作將從名冊中完全移除此人員，請確認是否僅為誤建之測試帳號！`)) {
      return;
    }

    members = members.filter(m => m.id !== retireId);
    Store.set('members', members);

    // 同步移除帳號
    const allAccs = getUserAccounts().filter(a => a.memberId !== retireId);
    Store.set('user_accounts', allAccs);

    document.getElementById('modalMemberRetire')?.classList.remove('open');
    updateAllViews();
    playFeedbackSound('success');
    showToast(`已徹底刪除【${mem.name}】之隊員帳號！`, '🗑️');
  });
}

function exportRosterToExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('SheetJS 模組載入中，請稍候重試...', '⚠️');
    return;
  }

  const wb = XLSX.utils.book_new();

  // 取得除了 m0 承辦人以外的所有 54 位義消同仁
  const volunteerList = members.filter(m => m.id !== 'm0' && !m.role.includes('警消'));

  // 排序：依小隊順序與職務
  const squadOrder = { '分隊幹部': 1, '第一小隊': 2, '第二小隊': 3, '第三小隊': 4, '中區': 5 };
  const roleOrder = { '幹部': 1, '小隊長': 2, '副小隊長': 3, '隊員': 4 };

  const sortedList = [...volunteerList].sort((a, b) => {
    const sa = squadOrder[a.squad] || 99;
    const sb = squadOrder[b.squad] || 99;
    if (sa !== sb) return sa - sb;
    const ra = roleOrder[a.squadRole] || 99;
    const rb = roleOrder[b.squadRole] || 99;
    return ra - rb;
  });

  const now = new Date();
  const dateStr = `${now.getFullYear() - 1911}年${now.getMonth() + 1}月${now.getDate()}日`;

  const excelRows = [
    ['臺中市消防局 鳳凰救護大隊 博館分隊 救護義消同仁編制與證照名冊'],
    [`製表日期：${dateStr}`, '', '', `官方編制人數：${sortedList.length} 人`, '', '', '單位：博館分隊救護義消'],
    [],
    ['編號', '所屬編制', '隊部職務', '姓名', 'EMT證照等級', '證照簡稱', '累計協勤時數', '救護出勤次數', '現場急救(ROSC)', '12導程心電圖', '靜脈注射(IV)', '聯絡電話', '入隊資歷']
  ];

  sortedList.forEach((m, idx) => {
    excelRows.push([
      idx + 1,
      m.squad || '',
      m.squadRole || m.role || '',
      m.name,
      m.level || '',
      m.levelCode || '',
      m.totalHours || 0,
      m.totalDispatches || 0,
      m.roscCount || 0,
      m.ecgCount || 0,
      m.ivCount || 0,
      m.phone || '',
      m.joined || ''
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(excelRows);
  
  // 設定欄寬
  ws['!cols'] = [
    { wch: 6 },  // 編號
    { wch: 14 }, // 所屬編制
    { wch: 14 }, // 隊部職務
    { wch: 12 }, // 姓名
    { wch: 22 }, // EMT證照等級
    { wch: 10 }, // 證照簡稱
    { wch: 14 }, // 累計協勤時數
    { wch: 14 }, // 救護出勤次數
    { wch: 14 }, // ROSC
    { wch: 14 }, // ECG
    { wch: 14 }, // IV
    { wch: 16 }, // 電話
    { wch: 14 }  // 入隊
  ];

  XLSX.utils.book_append_sheet(wb, ws, '義消人員名冊');
  XLSX.writeFile(wb, `博館分隊救護義消人員編制與證照名冊(${sortedList.length}人).xlsx`);
  showToast(`已成功匯出 ${sortedList.length} 位救護義消完整名冊 Excel！`, '📊');
}

// 初始化執行
// ==========================================

// ==============================================================================
// 義消同仁帳號身分驗證與密碼安全管理系統 (Authentication & Password Management)
// ==============================================================================

let currentPwdFilter = 'ALL'; // 'ALL', 'PENDING', 'DONE'
let tempPendingUser = null;

// 取得或初始化全隊帳號清單 (包含 1 位承辦人 + 54 位義消同仁)
function getUserAccounts() {
  let accs = Store.get('user_accounts', null);
  if (!accs || !Array.isArray(accs) || accs.length === 0) {
    accs = [];
    // 警消承辦人帳號 (代號: 博館，預設密碼: 0000)
    accs.push({
      id: 'acc-admin',
      username: '博館',
      name: '警消承辦人',
      memberId: 'm0',
      password: '0000',
      hasChangedPassword: true,
      passwordChangedAt: null,
      isAdmin: true
    });
    // 54 位義消同仁帳號 (帳號: 中文姓名，預設密碼: 1234，首次登入強制變更)
    members.forEach(m => {
      if (m.id !== 'm0') {
        accs.push({
          id: `acc-${m.id}`,
          username: m.name,
          name: m.name,
          memberId: m.id,
          password: '1234',
          hasChangedPassword: false,
          passwordChangedAt: null,
          isAdmin: false
        });
      }
    });
    Store.set('user_accounts', accs);
  } else {
    // 確保新增的義消隊員都有對應帳號
    let updated = false;
    members.forEach(m => {
      if (m.id !== 'm0') {
        const found = accs.find(a => a.username === m.name || a.memberId === m.id);
        if (!found) {
          accs.push({
            id: `acc-${m.id}`,
            username: m.name,
            name: m.name,
            memberId: m.id,
            password: '1234',
            hasChangedPassword: false,
            passwordChangedAt: null,
            isAdmin: false
          });
          updated = true;
        }
      }
    });
    if (!accs.find(a => a.username === '博館')) {
      accs.unshift({
        id: 'acc-admin',
        username: '博館',
        name: '警消承辦人',
        memberId: 'm0',
        password: '0000',
        hasChangedPassword: true,
        passwordChangedAt: null,
        isAdmin: true
      });
      updated = true;
    }
    if (updated) Store.set('user_accounts', accs);
  }
  return accs;
}

// 同步更新導覽列的登入狀態與身分呈現
function updateUserNavbarUi() {
  const badgeWrapper = document.getElementById('userAuthBadgeWrapper');
  const unauthWrapper = document.getElementById('unauthenticatedWrapper');
  const adminWrapper = document.getElementById('adminSimulateWrapper');
  const adminBanner = document.getElementById('adminModeBanner');
  const adminPwdCard = document.getElementById('adminPasswordTrackingCard');

  if (currentAuthUser) {
    if (badgeWrapper) badgeWrapper.style.display = 'flex';
    if (unauthWrapper) unauthWrapper.style.display = 'none';

    const avatarEl = document.getElementById('currentUserAvatar');
    const nameEl = document.getElementById('currentUserName');
    const pillEl = document.getElementById('currentUserPill');
    const roleBadgeEl = document.getElementById('currentMemberRoleBadge');

    const cur = getCurrentMember();
    const isAdm = isSuperAdmin();

    if (avatarEl) avatarEl.textContent = isAdm ? '👮‍♂️' : '👨‍🚒';
    if (nameEl) nameEl.textContent = isAdm ? '警消承辦人' : cur.name;
    if (pillEl) {
      pillEl.className = isAdm ? 'current-user-pill admin-pill' : 'current-user-pill';
    }
    if (roleBadgeEl) {
      if (isAdm) {
        roleBadgeEl.textContent = '👑 警消承辦人';
        roleBadgeEl.style.color = '#fbbf24';
        roleBadgeEl.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        roleBadgeEl.style.background = 'rgba(245, 158, 11, 0.15)';
      } else {
        roleBadgeEl.textContent = cur.level ? `⭐ ${cur.level}` : '⭐ 隊員';
        roleBadgeEl.style.color = '#38bdf8';
        roleBadgeEl.style.borderColor = 'rgba(56, 189, 248, 0.3)';
        roleBadgeEl.style.background = 'rgba(56, 189, 248, 0.15)';
      }
    }

    // 承辦人專屬介面連動
    const btnNewAnn = document.getElementById('btnOpenNewAnnouncementModal');
    if (btnNewAnn) btnNewAnn.style.display = isAdm ? 'inline-flex' : 'none';

    const btnAddMem = document.getElementById('btnOpenAddMemberModal');
    if (btnAddMem) btnAddMem.style.display = isAdm ? 'inline-flex' : 'none';

    if (isAdm) {
      if (adminWrapper) adminWrapper.style.display = 'flex';
      if (adminBanner) adminBanner.style.display = 'flex';
      if (adminPwdCard) adminPwdCard.style.display = 'block';
    } else {
      if (adminWrapper) adminWrapper.style.display = 'none';
      if (adminBanner) adminBanner.style.display = 'none';
      if (adminPwdCard) adminPwdCard.style.display = 'none';
    }
  } else {
    // 尚未登入狀態
    const btnNewAnn = document.getElementById('btnOpenNewAnnouncementModal');
    if (btnNewAnn) btnNewAnn.style.display = 'none';

    const btnAddMem = document.getElementById('btnOpenAddMemberModal');
    if (btnAddMem) btnAddMem.style.display = 'none';

    if (badgeWrapper) badgeWrapper.style.display = 'none';
    if (unauthWrapper) unauthWrapper.style.display = 'flex';
    if (adminWrapper) adminWrapper.style.display = 'none';
    if (adminBanner) adminBanner.style.display = 'none';
    if (adminPwdCard) adminPwdCard.style.display = 'none';
  }
}

// 警消承辦人：全隊義消同仁密碼變更列管看板渲染
function renderAdminPasswordTrackingTable() {
  const card = document.getElementById('adminPasswordTrackingCard');
  if (!card || !isSuperAdmin()) return;

  const accounts = getUserAccounts().filter(a => !a.isAdmin); // 54 位義消同仁
  const total = accounts.length;
  const pendingList = accounts.filter(a => !a.hasChangedPassword);
  const changedList = accounts.filter(a => a.hasChangedPassword);
  const totalChanged = changedList.length;
  const totalPending = pendingList.length;
  const rate = total > 0 ? Math.round((totalChanged / total) * 100) : 0;

  const statTotal = document.getElementById('pwdStatTotal');
  const statPending = document.getElementById('pwdStatPending');
  const statChanged = document.getElementById('pwdStatChanged');
  const statRate = document.getElementById('pwdStatRate');

  if (statTotal) statTotal.innerHTML = `${total} <span style="font-size: 0.82rem; color: var(--text-muted);">人</span>`;
  if (statPending) statPending.innerHTML = `${totalPending} <span style="font-size: 0.82rem; color: var(--text-muted);">人</span>`;
  if (statChanged) statChanged.innerHTML = `${totalChanged} <span style="font-size: 0.82rem; color: var(--text-muted);">人</span>`;
  if (statRate) statRate.textContent = `${rate}%`;

  let displayList = accounts;
  if (currentPwdFilter === 'PENDING') displayList = pendingList;
  else if (currentPwdFilter === 'DONE') displayList = changedList;

  const tbody = document.getElementById('adminPasswordTableTbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  displayList.forEach((acc, idx) => {
    const mem = members.find(m => m.id === acc.memberId) || { squad: '隊員', squadRole: '隊員', level: 'EMT' };
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td style="font-weight: 700; color: #f8fafc;">${acc.name}</td>
      <td>${mem.squad || '-'}</td>
      <td>${mem.squadRole || mem.role || '隊員'} (${mem.level || 'EMT'})</td>
      <td><code style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; color: #38bdf8;">${acc.username}</code></td>
      <td>
        ${acc.hasChangedPassword ? 
          `<span class="pwd-status-pill done"><span>✅</span> 已變更專屬密碼</span>` : 
          `<span class="pwd-status-pill pending"><span>⚠️</span> 尚未變更 (預設 1234)</span>`}
      </td>
      <td style="color: var(--text-muted); font-size: 0.8rem;">
        ${acc.passwordChangedAt || '尚未完成首次登入'}
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn-reset-pwd" data-reset-account="${acc.username}" title="若同仁忘記密碼，重設為預設密碼 1234">
          <span>🔄 重設為 1234</span>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 綁定一鍵重設密碼按鈕
  tbody.querySelectorAll('[data-reset-account]').forEach(btn => {
    btn.addEventListener('click', () => {
      const u = btn.getAttribute('data-reset-account');
      if (confirm(`確定要將【${u}】的登入密碼重設為預設值 1234 嗎？\n重設後，該隊員下次登入將再次被強制要求設定專屬新密碼。`)) {
        const allAccs = getUserAccounts();
        const target = allAccs.find(a => a.username === u);
        if (target) {
          target.password = '1234';
          target.hasChangedPassword = false;
          target.passwordChangedAt = null;
          Store.set('user_accounts', allAccs);
          pushUserAccountToSupabase(target);
          notifyCrossTabSync();
          renderAdminPasswordTrackingTable();
          showToast(`已成功將【${u}】密碼重設為預設 1234，並已同步至雲端！`, '🔑');
        }
      }
    });
  });
}

// 匯出全隊密碼變更進度清冊 Excel
function exportPasswordTrackingExcel() {
  const accounts = getUserAccounts().filter(a => !a.isAdmin);
  const wb = XLSX.utils.book_new();
  const rows = [
    ['編號', '姓名', '所屬編制', '隊部職務', 'EMT證照', '登入帳號', '密碼狀態', '預設密碼', '密碼變更時間']
  ];

  accounts.forEach((acc, i) => {
    const mem = members.find(m => m.id === acc.memberId) || {};
    rows.push([
      i + 1,
      acc.name,
      mem.squad || '',
      mem.squadRole || mem.role || '隊員',
      mem.level || '',
      acc.username,
      acc.hasChangedPassword ? '已變更專屬密碼' : '尚未變更密碼',
      acc.hasChangedPassword ? '已啟用個人防護' : '1234',
      acc.passwordChangedAt || '尚未變更'
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 6 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 18 },
    { wch: 14 },
    { wch: 22 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, '密碼變更列管清冊');
  XLSX.writeFile(wb, `博館分隊救護義消登入密碼變更進度清冊(${accounts.length}人).xlsx`);
  showToast('已成功匯出全隊密碼列管清冊 Excel！', '📥');
}

// 初始化所有登入、登出與密碼變更事件監聽器
function setupAuthSystem() {
  const portal = document.getElementById('mobileLoginPortal');
  const modalFirst = document.getElementById('modalFirstChangePassword');
  const modalChange = document.getElementById('modalChangePassword');

  function openLoginPortal(mode = 'volunteer') {
    if (!portal) return;
    portal.classList.remove('hidden');
    portal.style.display = 'flex';
    if (mode === 'volunteer') {
      const vView = document.getElementById('viewVolunteerLogin');
      const oView = document.getElementById('viewOfficerLogin');
      if (vView) vView.style.display = 'block';
      if (oView) oView.style.display = 'none';
      populateVolunteerSelect();
    } else {
      const vView = document.getElementById('viewVolunteerLogin');
      const oView = document.getElementById('viewOfficerLogin');
      if (vView) vView.style.display = 'none';
      if (oView) oView.style.display = 'block';
    }
  }
  window.openLoginPortal = openLoginPortal;

  function closeLoginPortal() {
    if (!portal) return;
    portal.classList.add('hidden');
    portal.style.display = 'none';
  }
  window.closeLoginPortal = closeLoginPortal;

  // 動態填入 54 位義消同仁分組姓名選單 (免手動打字)
  function populateVolunteerSelect() {
    const sel = document.getElementById('selectVolunteerName');
    if (!sel) return;

    const squadOrder = ['分隊幹部', '第一小隊', '第二小隊', '第三小隊', '中區'];
    const groups = {};
    squadOrder.forEach(sq => { groups[sq] = []; });

    members.forEach(m => {
      if (m.id === 'm0') return;
      const sq = m.squad || '第一小隊';
      if (!groups[sq]) groups[sq] = [];
      groups[sq].push(m);
    });

    const lastRemembered = Store.get('last_selected_volunteer', '');

    let html = `<option value="" disabled ${!lastRemembered ? 'selected' : ''}>請按此點選您的姓名...</option>`;
    squadOrder.forEach(sq => {
      const list = groups[sq] || [];
      if (list.length > 0) {
        html += `<optgroup label="🚒 ${sq} (${list.length}人)">`;
        list.forEach(m => {
          const isSel = m.name === lastRemembered ? 'selected' : '';
          html += `<option value="${m.name}" ${isSel}>${m.name} (${m.level || 'EMT'})</option>`;
        });
        html += `</optgroup>`;
      }
    });
    sel.innerHTML = html;

    if (lastRemembered) {
      updateVolunteerPreview(lastRemembered);
      updatePinInputPlaceholder(lastRemembered);
    }
  }

  function updatePinInputPlaceholder(name) {
    const pinInput = document.getElementById('inputVolunteerPin');
    if (!pinInput || !name) return;
    const allAccs = getUserAccounts();
    const matched = allAccs.find(a => a.username === name || a.name === name);
    if (matched && matched.hasChangedPassword) {
      pinInput.placeholder = '請輸入您的自訂專屬密碼';
    } else {
      pinInput.placeholder = '請輸入密碼 (預設 1234)';
    }
  }

  function updateVolunteerPreview(name) {
    const m = members.find(mem => mem.name === name);
    const prev = document.getElementById('selectedVolunteerPreview');
    if (!m || !prev) return;
    const nameEl = document.getElementById('prevVolName');
    const roleEl = document.getElementById('prevVolRole');
    if (nameEl) nameEl.textContent = m.name;
    if (roleEl) roleEl.textContent = `${m.squad || '隊員'}・${m.level || 'EMT'}`;
    prev.style.display = 'flex';
  }

  // 監聽義消姓名下拉切換
  document.getElementById('selectVolunteerName')?.addEventListener('change', (e) => {
    const name = e.target.value;
    updateVolunteerPreview(name);
    Store.set('last_selected_volunteer', name);
    updatePinInputPlaceholder(name);
    const pinInput = document.getElementById('inputVolunteerPin');
    if (pinInput) {
      pinInput.value = '';
      pinInput.focus();
    }
  });

  // 密碼顯示切換
  const btnTogglePin = document.getElementById('btnTogglePinVisibility');
  const inputPin = document.getElementById('inputVolunteerPin');
  btnTogglePin?.addEventListener('click', () => {
    if (!inputPin) return;
    if (inputPin.type === 'password') {
      inputPin.type = 'text';
      btnTogglePin.textContent = '隱藏密碼';
    } else {
      inputPin.type = 'password';
      btnTogglePin.textContent = '顯示密碼';
    }
  });

  // 義消同仁一鍵極簡登入
  document.getElementById('formVolunteerQuickLogin')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const sel = document.getElementById('selectVolunteerName');
    const name = sel ? sel.value : '';
    const pin = document.getElementById('inputVolunteerPin')?.value.trim();

    if (!name) {
      showToast('請先點選您的義消姓名！', '⚠️');
      sel?.focus();
      return;
    }

    const allAccs = getUserAccounts();
    const matched = allAccs.find(a => a.username === name || a.name === name);

    if (!matched) {
      showToast('找不到此隊員帳號，請確認姓名是否在名冊中！', '❌');
      return;
    }

    if (matched.password !== pin) {
      if (matched.hasChangedPassword) {
        showToast(`【${matched.name}】密碼輸入錯誤！\n您先前已設定過個人專屬密碼，請輸入自訂密碼；\n若忘記密碼，請聯絡分隊承辦人一鍵重設。`, '❌');
      } else {
        showToast(`【${matched.name}】密碼輸入錯誤！\n尚未變更密碼前，預設密碼為 1234，請重新輸入。`, '❌');
      }
      playFeedbackSound('alert');
      document.getElementById('inputVolunteerPin')?.focus();
      return;
    }

    // 處理「記住此裝置」
    const remember = document.getElementById('checkRememberLogin')?.checked;
    Store.set('remember_login', !!remember);
    Store.set('last_selected_volunteer', name);

    // 首次登入 (預設密碼 1234 強制先變更密碼)
    if (!matched.isAdmin && !matched.hasChangedPassword) {
      tempPendingUser = matched;
      closeLoginPortal();
      const nameDisp = document.getElementById('firstLoginUserNameDisplay');
      if (nameDisp) nameDisp.textContent = matched.name;
      const fNew = document.getElementById('inputNewPasswordFirst');
      const fConf = document.getElementById('inputConfirmPasswordFirst');
      if (fNew) fNew.value = '';
      if (fConf) fConf.value = '';
      modalFirst?.classList.add('open');
      showToast(`歡迎【${matched.name}】！首次登入請先設定您的專屬新密碼以策安全。\n(請勿再使用 1234)`, '🛡️');
      return;
    }

    // 登入完成
    currentAuthUser = matched;
    Store.set('current_auth_user', currentAuthUser);
    currentMemberId = matched.memberId;
    Store.set('currentMemberId', currentMemberId);

    closeLoginPortal();
    updateUserNavbarUi();
    updateAllViews();
    playFeedbackSound('success');
    showToast(`登入成功！歡迎【${matched.name}】進入系統開始協勤`, '👨‍🚒');
  });

  // 切換警消承辦人登入模式
  document.getElementById('btnSwitchToOfficerLogin')?.addEventListener('click', () => {
    const vView = document.getElementById('viewVolunteerLogin');
    const oView = document.getElementById('viewOfficerLogin');
    if (vView) vView.style.display = 'none';
    if (oView) oView.style.display = 'block';
  });

  document.getElementById('btnSwitchToVolunteerLogin')?.addEventListener('click', () => {
    const vView = document.getElementById('viewVolunteerLogin');
    const oView = document.getElementById('viewOfficerLogin');
    if (vView) vView.style.display = 'block';
    if (oView) oView.style.display = 'none';
    populateVolunteerSelect();
  });

  // 警消承辦人登入表單
  document.getElementById('formOfficerLogin')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const uInput = document.getElementById('inputOfficerUsername');
    const pInput = document.getElementById('inputOfficerPassword');
    const username = uInput?.value.trim() || '';
    const password = pInput?.value.trim() || '';

    const allAccs = getUserAccounts();
    const matched = allAccs.find(a => a.username === username || (a.isAdmin && (username === '博館' || username === 'officer' || username === 'admin')));

    if (!matched || !matched.isAdmin) {
      showToast('非警消管理員帳號！請確認承辦帳號是否正確', '❌');
      playFeedbackSound('alert');
      uInput?.focus();
      return;
    }

    if (matched.password !== password) {
      showToast('承辦人管理密碼錯誤！(預設密碼為 0000)', '❌');
      playFeedbackSound('alert');
      pInput?.focus();
      return;
    }

    currentAuthUser = matched;
    Store.set('current_auth_user', currentAuthUser);
    currentMemberId = matched.memberId;
    Store.set('currentMemberId', currentMemberId);
    Store.set('remember_login', true);

    closeLoginPortal();
    updateUserNavbarUi();
    updateAllViews();
    playFeedbackSound('success');
    showToast(`登入成功！【分隊警消承辦人】最高全域管理模式已啟動`, '👮‍♂️');
  });

  // 開啟登入按鈕
  document.getElementById('btnOpenLoginModal')?.addEventListener('click', () => {
    openLoginPortal();
  });

  // 登出按鈕
  const handleLogout = () => {
    currentAuthUser = null;
    Store.set('current_auth_user', null);
    currentMemberId = null;
    Store.set('currentMemberId', null);
    Store.set('remember_login', false);
    updateUserNavbarUi();
    updateAllViews();
    openLoginPortal();
    showToast('您已成功安全登出系統！', '🚪');
  };

  document.getElementById('btnLogout')?.addEventListener('click', handleLogout);
  document.getElementById('drawerBtnLogout')?.addEventListener('click', handleLogout);

  // 開啟自行變更密碼彈窗按鈕
  document.getElementById('btnOpenChangePassword')?.addEventListener('click', () => {
    if (!currentAuthUser) {
      showToast('請先登入系統方可變更密碼！', '⚠️');
      openLoginPortal();
      return;
    }
    const oldInput = document.getElementById('inputOldPassword');
    const newInput = document.getElementById('inputNewPasswordUser');
    const confirmInput = document.getElementById('inputConfirmPasswordUser');
    if (oldInput) oldInput.value = '';
    if (newInput) newInput.value = '';
    if (confirmInput) confirmInput.value = '';
    modalChange?.classList.add('open');
  });

  // 6. 首次登入強制變更密碼提交處理
  document.getElementById('formFirstChangePassword')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!tempPendingUser) {
      modalFirst?.classList.remove('open');
      window.openLoginPortal?.('volunteer');
      return;
    }

    const newPwd = document.getElementById('inputNewPasswordFirst')?.value.trim() || '';
    const confirmPwd = document.getElementById('inputConfirmPasswordFirst')?.value.trim() || '';

    if (newPwd.length < 4) {
      showToast('新密碼長度至少需要 4 碼！', '⚠️');
      playFeedbackSound('alert');
      return;
    }

    if (newPwd === '1234') {
      showToast('新密碼不可再與預設密碼 1234 相同，請設定專屬新密碼！', '⚠️');
      playFeedbackSound('alert');
      return;
    }

    if (newPwd !== confirmPwd) {
      showToast('兩次輸入的新密碼不一致，請再次確認！', '⚠️');
      playFeedbackSound('alert');
      return;
    }

    // 儲存新密碼
    const allAccs = getUserAccounts();
    const acc = allAccs.find(a => a.username === tempPendingUser.username);
    if (acc) {
      acc.password = newPwd;
      acc.hasChangedPassword = true;
      acc.passwordChangedAt = new Date().toLocaleString('zh-TW');
      Store.set('user_accounts', allAccs);
      tempPendingUser = acc;
      pushUserAccountToSupabase(acc);
      notifyCrossTabSync();
    }

    // 轉為正式登入
    currentAuthUser = tempPendingUser;
    Store.set('current_auth_user', currentAuthUser);
    currentMemberId = currentAuthUser.memberId;
    Store.set('currentMemberId', currentMemberId);
    Store.set('remember_login', true);
    Store.set('last_selected_volunteer', currentAuthUser.name);
    tempPendingUser = null;

    modalFirst?.classList.remove('open');
    updateUserNavbarUi();
    updateAllViews();
    playFeedbackSound('success');
    showToast(`🎉 專屬新密碼設定成功！已為您開通博館協勤系統全部權限！`, '✅');
  });

  // 7. 自行變更密碼表單提交處理
  document.getElementById('formChangePassword')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentAuthUser) {
      showToast('尚未登入！', '⚠️');
      return;
    }

    const oldPwd = document.getElementById('inputOldPassword')?.value.trim() || '';
    const newPwd = document.getElementById('inputNewPasswordUser')?.value.trim() || '';
    const confirmPwd = document.getElementById('inputConfirmPasswordUser')?.value.trim() || '';

    if (oldPwd !== currentAuthUser.password) {
      showToast('目前舊密碼輸入錯誤，請重新確認！', '❌');
      playFeedbackSound('alert');
      return;
    }

    if (newPwd.length < 4) {
      showToast('新密碼長度至少需要 4 碼！', '⚠️');
      playFeedbackSound('alert');
      return;
    }

    if (newPwd !== confirmPwd) {
      showToast('兩次輸入的新密碼不一致！', '⚠️');
      playFeedbackSound('alert');
      return;
    }

    // 更新密碼
    const allAccs = getUserAccounts();
    const acc = allAccs.find(a => a.username === currentAuthUser.username);
    if (acc) {
      acc.password = newPwd;
      acc.hasChangedPassword = true;
      acc.passwordChangedAt = new Date().toLocaleString('zh-TW');
      Store.set('user_accounts', allAccs);
      currentAuthUser = acc;
      Store.set('current_auth_user', currentAuthUser);
      pushUserAccountToSupabase(acc);
      notifyCrossTabSync();
    }

    modalChange?.classList.remove('open');
    updateUserNavbarUi();
    updateAllViews();
    playFeedbackSound('success');
    showToast('個人密碼已成功變更，並已同步至雲端！請妥善保管', '🔐');
  });

  // 8. 密碼篩選按鈕
  document.getElementById('btnFilterPwdAll')?.addEventListener('click', () => {
    currentPwdFilter = 'ALL';
    updateFilterChipStyles();
    renderAdminPasswordTrackingTable();
  });
  document.getElementById('btnFilterPwdPending')?.addEventListener('click', () => {
    currentPwdFilter = 'PENDING';
    updateFilterChipStyles();
    renderAdminPasswordTrackingTable();
  });
  document.getElementById('btnFilterPwdDone')?.addEventListener('click', () => {
    currentPwdFilter = 'DONE';
    updateFilterChipStyles();
    renderAdminPasswordTrackingTable();
  });

  function updateFilterChipStyles() {
    ['btnFilterPwdAll', 'btnFilterPwdPending', 'btnFilterPwdDone'].forEach(id => {
      document.getElementById(id)?.classList.remove('active');
    });
    if (currentPwdFilter === 'ALL') document.getElementById('btnFilterPwdAll')?.classList.add('active');
    else if (currentPwdFilter === 'PENDING') document.getElementById('btnFilterPwdPending')?.classList.add('active');
    else if (currentPwdFilter === 'DONE') document.getElementById('btnFilterPwdDone')?.classList.add('active');
  }

  // 9. 匯出 Excel 按鈕
  document.getElementById('btnExportPasswordExcel')?.addEventListener('click', () => {
    exportPasswordTrackingExcel();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupAuthSystem();
  initMemberSelector();
  populateShiftDatesDropdown();
  setupPunchEvents();
  setupModals();
  setupAnnouncementEvents();
  setupExcelExport();
  setupDeviceToggle();
  setupCalendarControls();
  setupTabs();
  setupRosterControls();
  startClock();
  initSupabase();
  updateUserNavbarUi();
  if (currentAuthUser) {
    window.closeLoginPortal?.();
  } else {
    window.openLoginPortal?.('volunteer');
  }
});

