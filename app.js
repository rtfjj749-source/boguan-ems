import { INITIAL_MEMBERS, INITIAL_ATTENDANCE, INITIAL_DISPATCHES, INITIAL_SHIFTS, BADGE_DEFINITIONS, SQUAD_CONFIG } from './data.js?v=20261008_v21';

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

  return INITIAL_MEMBERS.map(official => {
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
        idNo: existing.idNo || official.idNo
      };
    }
    return { ...official };
  });
}

let members = syncOfficialMembers(Store.get('members', INITIAL_MEMBERS));
Store.set('members', members);
let attendance = Store.get('attendance', INITIAL_ATTENDANCE).map(a => {
  if (a.note && (a.note.includes('91車') || a.note.includes('92車'))) {
    return { ...a, note: a.note.replace(/9[12]車/g, '救護協勤') };
  }
  return a;
});
Store.set('attendance', attendance);
if (!Store.get('dispatches_cleared_by_user_req_v2')) {
  Store.set('dispatches', []);
  Store.set('dispatches_cleared_by_user_req_v2', true);
}
let dispatches = Store.get('dispatches', INITIAL_DISPATCHES);
// 清空預定排班以利乾淨測試 (清除舊版 localStorage 快取)
if (!Store.get('shifts_cleared_for_testing_v3')) {
  Store.set('shifts', []);
  Store.set('shifts_cleared_for_testing_v3', true);
}
let shifts = Store.get('shifts', INITIAL_SHIFTS)
  .filter(s => s.memberName && s.status !== '缺協勤') // 自動清理取消後遺留的空缺或缺協勤班次（不留缺額警示）
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
let activeDuty = Store.get('activeDuty', null); // { memberId, startTime: timestamp, dateStr }
let cancellationLogs = Store.get('cancellation_logs', [
  {
    id: 'can-1',
    shiftId: 's-mock',
    date: '115-10-06',
    period: '18:00-23:00',
    vehicle: '救護協勤',
    memberName: '韓寧',
    reason: '臨時工作加班 / 公司緊急公務',
    timestamp: '17:20'
  }
]);

// ==========================================
// 1.1 Supabase 雲端客戶端與即時同步引擎
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
    badge.textContent = isConnected ? '🟢 已連線至 Supabase 雲端資料庫' : '🟡 本地暫存模式 (LocalStorage)';
    badge.style.background = isConnected ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)';
    badge.style.color = isConnected ? '#34d399' : '#fbbf24';
    badge.style.borderColor = isConnected ? '#10b981' : 'rgba(245,158,11,0.4)';
  }
}

// 從 Supabase 雲端下拉資料
async function syncFromSupabase() {
  if (!supabaseClient) return;
  try {
    const { data: remoteShifts, error: sErr } = await supabaseClient.from('shifts').select('*');
    if (!sErr && remoteShifts) {
      shifts = remoteShifts
        .filter(s => s.member_name && s.status !== '缺協勤')
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
      // 同步清理雲端多餘的缺協勤/空紀錄
      if (remoteShifts.length > 0) {
        supabaseClient.from('shifts').delete().or('status.eq.缺協勤,member_name.eq.""').then(() => {});
      }
    }
  } catch (err) {
    console.warn('Sync from Supabase shifts failed:', err);
  }
}

// 建立 Realtime 即時推播監聽
function setupSupabaseRealtime() {
  if (!supabaseClient) return;
  try {
    supabaseClient
      .channel('public:shifts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, () => {
        showToast('雲端排班表已由其他同仁更新，已即時同步！', '⚡');
        syncFromSupabase();
      })
      .subscribe();
  } catch (e) {
    console.warn('Realtime subscription error:', e);
  }
}

// 將變更同步推送至 Supabase 雲端
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
    'cadre': { label: '🏛️ 分隊幹部 (5人)', el: document.createElement('optgroup') },
    'squad1': { label: '🚒 第一小隊 (12人)', el: document.createElement('optgroup') },
    'squad2': { label: '🚒 第二小隊 (10人)', el: document.createElement('optgroup') },
    'squad3': { label: '🚒 第三小隊 (12人)', el: document.createElement('optgroup') },
    'central': { label: '🚒 中區小隊 (15人)', el: document.createElement('optgroup') }
  };

  Object.values(groups).forEach(g => {
    g.el.label = g.label;
  });

  members.forEach(m => {
    const isAdm = m.id === 'm0' || (m.role && (m.role.includes('警消') || m.role.includes('承辦人')));
    const opt = document.createElement('option');
    opt.value = m.id;

    let rolePrefix = '';
    if (isAdm) rolePrefix = '👮‍♂️ ';
    else if (m.squadRole === '幹部') rolePrefix = '🎖️ ';
    else if (m.squadRole === '小隊長') rolePrefix = '⭐ ';
    else if (m.squadRole === '副小隊長') rolePrefix = '🌟 ';

    const roleDetail = m.squadRole && m.squadRole !== '隊員' ? ` (${m.squadRole}・${m.level})` : ` (${m.level})`;
    opt.textContent = `${rolePrefix}${m.name}${roleDetail}`;
    if (m.id === currentMemberId) opt.selected = true;

    if (isAdm) {
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
  const boxIn = document.getElementById('boxBackfillInTrigger');
  const boxOut = document.getElementById('boxAdjustOutTrigger');
  
  // 檢查當前隊員是否在隊協勤中
  const isOnDuty = activeDuty && activeDuty.memberId === cur.id;

  if (isOnDuty) {
    statusPill.className = 'status-pill';
    statusText.textContent = `協勤值勤中 (博館駐地)`;
    btnIn.disabled = true;
    btnOut.disabled = false;
    btnIn.classList.add('disabled');
    btnOut.classList.remove('disabled');
    if (boxIn) boxIn.style.display = 'none';
    if (boxOut) boxOut.style.display = 'block';
  } else {
    statusPill.className = 'status-pill offline';
    statusText.textContent = `尚未簽到 (離隊)`;
    btnIn.disabled = false;
    btnOut.disabled = true;
    btnIn.classList.remove('disabled');
    btnOut.classList.add('disabled');
    if (boxIn) boxIn.style.display = 'block';
    if (boxOut) boxOut.style.display = 'none';
    document.getElementById('dutyTimerDisplay').textContent = '00:00:00';
  }
}

// 本月個人即時戰報試算
function updatePersonalSummary() {
  const cur = getCurrentMember();
  // 篩選本月 (115-10) 簽到
  const myMonthlyAtt = attendance.filter(a => a.memberName === cur.name && a.date.startsWith('115-10'));
  const totalHours = myMonthlyAtt.reduce((sum, a) => sum + (Number(a.hours) || 0), 0);
  const totalDispatches = myMonthlyAtt.reduce((sum, a) => sum + (Number(a.dispatches) || 0), 0);
  const totalPatients = myMonthlyAtt.reduce((sum, a) => sum + (Number(a.patients) || 0), 0);
  // 誤餐費試算：每次出勤達 4 小時發給 $100
  const eligibleCount = myMonthlyAtt.filter(a => Number(a.hours) >= 4).length;
  const subsidyAmount = eligibleCount * 100;

  document.getElementById('myMonthlyHours').textContent = totalHours.toFixed(1);
  document.getElementById('myMonthlyDispatches').textContent = totalDispatches;
  document.getElementById('myMealSubsidy').textContent = `$${subsidyAmount}`;
  document.getElementById('myPatients').textContent = totalPatients;
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
    const vehicleClass = d.vehicle.includes('91') ? 'v91' : (d.vehicle.includes('92') ? 'v92' : 'v-ems');

    const tagsHtml = d.treatments.map(t => {
      const isSpecial = ['CPR', 'AED', '12導程心電圖', '靜脈注射'].includes(t);
      return `<span class="treatment-tag ${isSpecial ? 'highlight' : ''}">${t}</span>`;
    }).join('');

    card.innerHTML = `
      <div class="dispatch-header">
        <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
          <span class="case-id-tag">${d.caseNo}</span>
          <span class="vehicle-pill ${vehicleClass}">${d.vehicle}</span>
          <span style="font-weight: 600; font-size: 0.95rem;">${d.resultType}</span>
          ${d.specialTag ? `<span style="background: rgba(245,158,11,0.2); color: #fbbf24; border: 1px solid rgba(245,158,11,0.4); font-size: 0.75rem; padding: 2px 8px; border-radius: 99px; font-weight: 700;">${d.specialTag}</span>` : ''}
          ${isAdm ? `
            <div style="display: inline-flex; gap: 4px; margin-left: auto;">
              <button class="btn-admin-edit btn-admin-edit-disp" data-id="${d.id}" style="font-size: 0.72rem; padding: 2px 6px;">✏️ 編輯</button>
              <button class="btn-admin-delete btn-admin-delete-disp" data-id="${d.id}" style="font-size: 0.72rem; padding: 2px 6px;">🗑️ 刪除</button>
            </div>
          ` : ''}
        </div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">
          <span>📅 ${d.date}</span> ｜ <span>⏰ ${d.departureTime} ~ ${d.returnTime}</span>
        </div>
      </div>

      <div class="dispatch-meta">
        <div class="dispatch-meta-item">📍 <strong>地點：</strong> ${d.location}</div>
        <div class="dispatch-meta-item">🏥 <strong>送往：</strong> ${d.hospital || '無'}</div>
        <div class="dispatch-meta-item">👨‍🚒 <strong>出勤義消：</strong> <span style="color: #38bdf8; font-weight: 700;">${d.memberNames.join('、')}</span></div>
      </div>

      ${d.chiefComplaint ? `<div style="font-size: 0.85rem; color: #cbd5e1; margin-top: 0.25rem;">📝 <strong>傷病主訴：</strong>${d.chiefComplaint}</div>` : ''}

      <div class="treatment-tags">
        <strong style="font-size: 0.75rem; color: var(--text-dim); align-self: center;">現場處置：</strong>
        ${tagsHtml}
      </div>
    `;
    container.appendChild(card);
  });

  if (isAdm) {
    container.querySelectorAll('.btn-admin-edit-disp').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        openEditDispatchModal(id);
      });
    });
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
    timestamp: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
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
      showToast('排班表已完全清空，可開始乾淨測試！', '🧹');
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
    const dispatchesCount = memberAtt.reduce((sum, a) => sum + (Number(a.dispatches) || 0), 0);
    const patientsCount = memberAtt.reduce((sum, a) => sum + (Number(a.patients) || 0), 0);
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

  // 渲染出勤明細前 5 筆預覽
  const dispatchTbody = document.getElementById('dispatchReportTbody');
  dispatchTbody.innerHTML = '';
  dispatches.slice(0, 5).forEach((d, idx) => {
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
      <td>${d.isIdle ? '空跑' : d.patientCount + '人'}</td>
    `;
    dispatchTbody.appendChild(tr);
  });
}

let chartDailyStaffingInstance = null;
let chartVehicleBreakdownInstance = null;

function renderOfficerExecutiveDashboard() {
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

  // ROSC count
  const roscCount = members.reduce((sum, m) => sum + (Number(m.roscCount) || 0), 0);
  const elRosc = document.getElementById('dashKpiRosc');
  if (elRosc) elRosc.textContent = `${roscCount} 件 ROSC`;

  // Compliance
  const restricted = members.filter(m => m.isRestricted).length;
  const compRate = members.length > 0 ? (((members.length - restricted) / members.length) * 100).toFixed(1) : '100';
  const elComp = document.getElementById('dashKpiCompliance');
  if (elComp) elComp.textContent = `${compRate}%`;

  // Fill Table
  const tbody = document.getElementById('dashOfficerTableTbody');
  if (tbody) {
    tbody.innerHTML = '';
    const sorted = [...members].sort((a, b) => (Number(b.totalHours) || 0) - (Number(a.totalHours) || 0));
    sorted.forEach((m, idx) => {
      const memberAtt = attendance.filter(a => a.memberName === m.name && a.date.startsWith('115-10'));
      const days = memberAtt.length;
      const hours = memberAtt.reduce((sum, a) => sum + (Number(a.hours) || 0), 0);
      const dispatchesCount = memberAtt.reduce((sum, a) => sum + (Number(a.dispatches) || 0), 0);
      const patientsCount = memberAtt.reduce((sum, a) => sum + (Number(a.patients) || 0), 0);
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

function updateAllViews() {
  updateUserNavbarUi();
  updateDutyHero();
  updatePersonalSummary();
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
    // 格式化當前時間
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const clockEl = document.getElementById('clockLive');
    if (clockEl) clockEl.textContent = `當前系統時間：${timeStr}`;

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

// 核心打卡簽到執行邏輯
function performPunchIn(actualTimeStr = null, reason = '') {
  if (!isLoggedIn()) {
    showToast('請先登入義消同仁帳號方可進行協勤簽到！', '⚠️');
    document.getElementById('modalLogin')?.classList.add('open');
    return;
  }
  const cur = getCurrentMember();
  const now = new Date();
  const dateStr = getCurrentRocDate();
  const timeStr = actualTimeStr || now.toTimeString().substring(0, 5);

  let startTimeMs = Date.now();
  if (actualTimeStr) {
    const [h, m] = actualTimeStr.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    startTimeMs = d.getTime();
  }

  activeDuty = {
    memberId: cur.id,
    memberName: cur.name,
    startTime: startTimeMs,
    dateStr: dateStr,
    timeStr: timeStr,
    isBackfilled: !!actualTimeStr,
    backfillReason: reason
  };
  Store.set('activeDuty', activeDuty);
  updateDutyHero();
  updateAllViews();
  playFeedbackSound('success');
  
  if (actualTimeStr) {
    showToast(`補登成功！${cur.name} 已校正為 ${timeStr} 到隊協勤（在隊累積已同步起算）`, '📍');
  } else {
    showToast(`簽到成功！${cur.name} 已於 ${timeStr} 在博館分隊開始協勤`, '📍');
  }
}

// 核心簽退離隊執行邏輯
function performPunchOut(actualTimeStr = null, reason = '') {
  if (!activeDuty) return;
  const cur = getCurrentMember();
  const now = new Date();
  const signOutTime = actualTimeStr || now.toTimeString().substring(0, 5);

  const inMin = timeToMinutes(activeDuty.timeStr);
  const outMin = timeToMinutes(signOutTime);
  let durationMinutes = outMin - inMin;
  if (durationMinutes < 0) durationMinutes += 24 * 60; // 跨班/跨夜情況

  const durationHours = Math.max(0.5, Math.round((durationMinutes / 60) * 10) / 10);
  const isMealEligible = durationHours >= 4.0;

  let note = '即時手機打卡協勤';
  if (activeDuty.isBackfilled && reason) {
    note = `補登到隊(${activeDuty.backfillReason})，校正離隊(${reason})`;
  } else if (activeDuty.isBackfilled) {
    note = `補登到隊協勤 (${activeDuty.backfillReason})`;
  } else if (reason) {
    note = `校正離隊協勤 (${reason})`;
  }

  const newAtt = {
    id: `att-${Date.now()}`,
    memberId: cur.id,
    memberName: cur.name,
    date: activeDuty.dateStr,
    signIn: activeDuty.timeStr,
    signOut: signOutTime,
    hours: durationHours,
    dispatches: 1,
    patients: 1,
    note: note
  };

  attendance.unshift(newAtt);
  Store.set('attendance', attendance);

  cur.totalHours = (Number(cur.totalHours) || 0) + durationHours;
  Store.set('members', members);

  activeDuty = null;
  Store.set('activeDuty', null);

  updateAllViews();
  playFeedbackSound('success');
  showToast(`簽退完成！本日協勤 ${durationHours} 小時已存入系統${isMealEligible ? '（符合誤餐費資格）' : ''}`, '🏁');
}

function setupPunchEvents() {
  const btnIn = document.getElementById('btnPunchIn');
  const btnOut = document.getElementById('btnPunchOut');

  // 一鍵到隊簽到 (當前時間)
  btnIn?.addEventListener('click', () => {
    performPunchIn();
  });

  // 一鍵簽退離開 (當前時間)
  btnOut?.addEventListener('click', () => {
    performPunchOut();
  });

  // Modal 5: 補登到隊時間 (限當日 6 小時內)
  const btnOpenBackfill = document.getElementById('btnOpenBackfillIn');
  const modalBackfill = document.getElementById('modalBackfillIn');
  const formBackfill = document.getElementById('formBackfillIn');
  const inputBackfillTime = document.getElementById('inputBackfillTime');

  btnOpenBackfill?.addEventListener('click', () => {
    const cur = getCurrentMember();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const minAllowedMin = Math.max(0, nowMin - 360); // 嚴格限制：最多往回 6 小時
    const minTimeStr = minutesToTime(minAllowedMin);
    const maxTimeStr = minutesToTime(nowMin);

    const nameEl = document.getElementById('inputBackfillMemberName');
    if (nameEl) nameEl.value = cur.name;
    const dateEl = document.getElementById('inputBackfillDate');
    if (dateEl) dateEl.value = `${getCurrentRocDate()} (今日)`;

    if (inputBackfillTime) {
      inputBackfillTime.value = maxTimeStr;
      inputBackfillTime.min = minTimeStr;
      inputBackfillTime.max = maxTimeStr;
    }
    const hintEl = document.getElementById('backfillTimeLimitHint');
    if (hintEl) {
      hintEl.textContent = `※ 依分隊規定限當日 6 小時內：最早可補選 ${minTimeStr}，最晚為當前時間 ${maxTimeStr}`;
    }
    modalBackfill?.classList.add('open');
  });

  formBackfill?.addEventListener('submit', (e) => {
    e.preventDefault();
    const chosenVal = inputBackfillTime?.value;
    if (!chosenVal) return;

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const minAllowedMin = Math.max(0, nowMin - 360);
    const chosenMin = timeToMinutes(chosenVal);

    if (chosenMin > nowMin) {
      alert('【時間無效】到隊時間不可超過當前系統時間！');
      return;
    }
    if (chosenMin < minAllowedMin) {
      alert(`【超出校正範圍】依分隊規定，補登到隊時間最多僅限往回校正當日 6 小時內（最早可選 ${minutesToTime(minAllowedMin)}）！`);
      return;
    }

    const reasonEl = document.querySelector('input[name="backfillReason"]:checked');
    const reason = reasonEl ? reasonEl.value : '忙碌忘了打卡';

    performPunchIn(chosenVal, reason);
    modalBackfill?.classList.remove('open');
  });

  // Modal 6: 校正離隊簽退時間 (限當日 6 小時內)
  const btnOpenAdjust = document.getElementById('btnOpenAdjustOut');
  const modalAdjust = document.getElementById('modalAdjustOut');
  const formAdjust = document.getElementById('formAdjustOut');
  const inputAdjustOut = document.getElementById('inputAdjustOutTime');

  function updateAdjustOutPreview() {
    if (!activeDuty || !inputAdjustOut) return;
    const inMin = timeToMinutes(activeDuty.timeStr);
    const outMin = timeToMinutes(inputAdjustOut.value);
    let diff = outMin - inMin;
    if (diff < 0) diff += 24 * 60;
    const hrs = Math.max(0.5, Math.round((diff / 60) * 10) / 10);
    const hrsEl = document.getElementById('previewAdjustHours');
    if (hrsEl) hrsEl.textContent = `${hrs.toFixed(1)} hr`;
    const mealEl = document.getElementById('previewAdjustMeal');
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

  btnOpenAdjust?.addEventListener('click', () => {
    if (!activeDuty) return;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const inMin = timeToMinutes(activeDuty.timeStr);
    const minAllowedMin = Math.max(inMin, nowMin - 360);
    const minTimeStr = minutesToTime(minAllowedMin);
    const maxTimeStr = minutesToTime(nowMin);

    const signInDisplay = document.getElementById('inputAdjustOutSignInTime');
    if (signInDisplay) {
      signInDisplay.value = `${activeDuty.dateStr} 📍 ${activeDuty.timeStr}`;
    }
    if (inputAdjustOut) {
      inputAdjustOut.value = maxTimeStr;
      inputAdjustOut.min = minTimeStr;
      inputAdjustOut.max = maxTimeStr;
    }
    const hintEl = document.getElementById('adjustOutTimeLimitHint');
    if (hintEl) {
      hintEl.textContent = `※ 限簽到時間 ${activeDuty.timeStr} 至當前時間 ${maxTimeStr} 之間（往回最多 6 小時）`;
    }
    updateAdjustOutPreview();
    modalAdjust?.classList.add('open');
  });

  inputAdjustOut?.addEventListener('input', updateAdjustOutPreview);

  formAdjust?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!activeDuty || !inputAdjustOut) return;
    const chosenVal = inputAdjustOut.value;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const inMin = timeToMinutes(activeDuty.timeStr);
    const minAllowedMin = Math.max(inMin, nowMin - 360);
    const chosenMin = timeToMinutes(chosenVal);

    if (chosenMin < inMin) {
      alert('【時間無效】離隊時間不可早於到隊簽到時間！');
      return;
    }
    if (chosenMin > nowMin) {
      alert('【時間無效】離隊時間不可超過當前系統時間！');
      return;
    }
    if (nowMin - chosenMin > 360) {
      alert(`【超出校正範圍】依分隊規定，離隊時間最多僅限往回校正 6 小時內（最早可選 ${minutesToTime(minAllowedMin)}）！`);
      return;
    }

    const reasonEl = document.querySelector('input[name="adjustOutReason"]:checked');
    const reason = reasonEl ? reasonEl.value : '離開時忘記按簽退';

    performPunchOut(chosenVal, reason);
    modalAdjust?.classList.remove('open');
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
  const modal = document.getElementById('modalNewDispatch');
  if (!modal) return;
  modal.setAttribute('data-edit-id', d.id);
  
  const title = modal.querySelector('h3');
  if (title) title.textContent = `✏️ 編輯救護出勤紀錄 (${d.caseNo})`;

  document.getElementById('inputCaseNo').value = d.caseNo;
  document.getElementById('inputVehicle').value = d.vehicle || '博館91';
  document.getElementById('inputDepartureTime').value = d.departureTime || '20:00';
  document.getElementById('inputReturnTime').value = d.returnTime || '21:10';
  document.getElementById('inputLocation').value = d.location || '';
  if (d.memberNames && d.memberNames[0]) {
    document.getElementById('inputDispatchMember').value = d.memberNames[0];
  }
  document.getElementById('inputResultType').value = d.resultType || '送醫';
  document.getElementById('inputHospital').value = d.hospital || '中國醫藥大學附設醫院';
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
  updateAllViews();
  showToast(`已刪除救護出勤紀錄案號 ${d.caseNo}！`, '🗑️');
  playFeedbackSound('success');
}

function setupModals() {
  const modalDispatch = document.getElementById('modalNewDispatch');
  const modalClaim = document.getElementById('modalClaimShift');

  // 開啟出勤 Modal (重設為新增狀態)
  function openCreateDispatchModal() {
    modalDispatch.removeAttribute('data-edit-id');
    const title = modalDispatch.querySelector('h3');
    if (title) title.textContent = '🚑 登記救護出勤紀錄';
    document.getElementById('inputCaseNo').value = `1151007-${String(dispatches.length + 1).padStart(2, '0')}`;
    document.getElementById('inputDispatchMember').value = getCurrentMember().name;
    modalDispatch.classList.add('open');
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

  // 表單 1: 登記或修改出勤案件
  document.getElementById('formNewDispatch')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const caseNo = document.getElementById('inputCaseNo').value;
    const vehicle = document.getElementById('inputVehicle').value;
    const departureTime = document.getElementById('inputDepartureTime').value;
    const returnTime = document.getElementById('inputReturnTime').value;
    const location = document.getElementById('inputLocation').value;
    const memberName = document.getElementById('inputDispatchMember').value;
    const resultType = document.getElementById('inputResultType').value;
    const hospital = document.getElementById('inputHospital').value;
    const chiefComplaint = document.getElementById('inputComplaint').value;

    const treatments = [];
    document.querySelectorAll('input[name="treatment"]:checked').forEach(cb => {
      treatments.push(cb.value);
    });

    const isRosc = resultType.includes('ROSC');
    const isIdle = resultType.includes('空跑');

    const editId = modalDispatch.getAttribute('data-edit-id');
    if (editId) {
      // 警消編輯修改既有出勤紀錄
      const idx = dispatches.findIndex(d => d.id === editId);
      if (idx !== -1) {
        dispatches[idx] = {
          ...dispatches[idx],
          caseNo,
          vehicle,
          departureTime,
          returnTime,
          location,
          memberNames: [memberName],
          resultType,
          patientCount: isIdle ? 0 : 1,
          isIdle,
          treatments,
          chiefComplaint,
          hospital: isIdle ? '無' : hospital,
          isSpecial: isRosc || treatments.includes('12導程心電圖'),
          specialTag: isRosc ? '🌟 ROSC 急救成功' : (treatments.includes('12導程心電圖') ? '📈 12-Lead ECG 傳輸' : '')
        };
      }
      modalDispatch.removeAttribute('data-edit-id');
      const title = modalDispatch.querySelector('h3');
      if (title) title.textContent = '🚑 登記救護出勤紀錄';
      Store.set('dispatches', dispatches);
      modalDispatch.classList.remove('open');
      updateAllViews();
      playFeedbackSound('success');
      showToast(`救護出勤案號 ${caseNo} 資料已成功更新！`, '💾');
      return;
    }

    const newDisp = {
      id: `disp-${Date.now()}`,
      caseNo,
      date: '115-10-07',
      vehicle,
      departureTime,
      returnTime,
      location,
      memberIds: [currentMemberId],
      memberNames: [memberName],
      resultType,
      patientCount: isIdle ? 0 : 1,
      isIdle,
      treatments,
      chiefComplaint,
      hospital: isIdle ? '無' : hospital,
      isSpecial: isRosc || treatments.includes('12導程心電圖'),
      specialTag: isRosc ? '🌟 ROSC 急救成功' : (treatments.includes('12導程心電圖') ? '📈 12-Lead ECG 傳輸' : '')
    };

    dispatches.unshift(newDisp);
    Store.set('dispatches', dispatches);

    // 同步升級志工數據 (供徽章判讀)
    const mem = members.find(m => m.name === memberName);
    if (mem) {
      mem.totalDispatches = (Number(mem.totalDispatches) || 0) + 1;
      if (isRosc) mem.roscCount = (Number(mem.roscCount) || 0) + 1;
      if (treatments.includes('12導程心電圖')) mem.ecgCount = (Number(mem.ecgCount) || 0) + 1;
      if (treatments.includes('靜脈注射')) mem.ivCount = (Number(mem.ivCount) || 0) + 1;
      Store.set('members', members);
    }

    modalDispatch.classList.remove('open');
    updateAllViews();
    playFeedbackSound('success');
    showToast(`救護出勤案號 ${caseNo} 登記完成！榮譽履歷已連動`, '🚑');
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
    const sIn = document.getElementById('adminAttSignIn').value;
    const sOut = document.getElementById('adminAttSignOut').value;
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
    const signIn = document.getElementById('adminAttSignIn').value;
    const signOut = document.getElementById('adminAttSignOut').value;
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
// 8. 頁籤切換 (Tabs)
// ==========================================
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

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

function renderRosterView() {
  const cardsContainer = document.getElementById('rosterCardsContainer');
  const tableContainer = document.getElementById('rosterTableContainer');
  const tbody = document.getElementById('rosterTableTbody');
  if (!cardsContainer) return;

  // 取得除了 m0 承辦人以外的所有 54 位義消同仁
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

    return true;
  });

  // 更新頂部各統計徽章計數
  const countAll = volunteerList.length;
  const countCadre = volunteerList.filter(m => m.squad === '分隊幹部').length;
  const countSquad1 = volunteerList.filter(m => m.squad === '第一小隊').length;
  const countSquad2 = volunteerList.filter(m => m.squad === '第二小隊').length;
  const countSquad3 = volunteerList.filter(m => m.squad === '第三小隊').length;
  const countCentral = volunteerList.filter(m => m.squad === '中區').length;

  const setElText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setElText('countChipAll', countAll);
  setElText('countChipCadre', countCadre);
  setElText('countChipSquad1', countSquad1);
  setElText('countChipSquad2', countSquad2);
  setElText('countChipSquad3', countSquad3);
  setElText('countChipCentral', countCentral);

  // 1. 卡片檢視渲染
  if (rosterFilterState.viewMode === 'cards') {
    cardsContainer.style.display = 'block';
    if (tableContainer) tableContainer.style.display = 'none';

    if (filtered.length === 0) {
      cardsContainer.innerHTML = `
        <div class="glass-card" style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🔍</div>
          <div style="font-size: 1.1rem; font-weight: 700; color: #f8fafc;">查無符合條件的義消同仁</div>
          <p style="font-size: 0.85rem; margin-top: 0.25rem;">請嘗試調整搜尋關鍵字或清除篩選條件</p>
        </div>
      `;
      return;
    }

    // 定義 5 大編制分組
    const squads = [
      { id: '分隊幹部', name: '分隊幹部', icon: '🏛️', isCadre: true, desc: '隊務策劃、協勤行政督導與救護品管核心' },
      { id: '第一小隊', name: '第一小隊', icon: '🚒', isCadre: false, desc: '第一救護協勤責任分組 (小隊長 鄭暐勲 / 副小隊長 洪銘聰)' },
      { id: '第二小隊', name: '第二小隊', icon: '🚒', isCadre: false, desc: '第二救護協勤責任分組 (小隊長 李忠南 / 副小隊長 謝易庭)' },
      { id: '第三小隊', name: '第三小隊', icon: '🚒', isCadre: false, desc: '第三救護協勤責任分組 (小隊長 曾子庭 / 副小隊長 林立強)' },
      { id: '中區',     name: '中區',     icon: '🚒', isCadre: false, desc: '中區責任責任編制救護同仁協勤組' }
    ];

    let html = '';

    squads.forEach(sq => {
      // 找出該小隊內符合篩選的隊員
      const squadMembers = filtered.filter(m => m.squad === sq.id);
      if (squadMembers.length === 0) return;

      // 排序：小隊長最先、副小隊長其次、幹部次之、其餘隊員
      squadMembers.sort((a, b) => {
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
            ${squadMembers.map(m => renderMemberCardHtml(m)).join('')}
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
        return `
          <tr style="${isCur ? 'background: rgba(6,182,212,0.1); font-weight: 700;' : ''}">
            <td style="color: var(--text-dim); text-align: center;">${idx + 1}</td>
            <td>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="font-size: 1.2rem;">${m.avatar}</span>
                <span style="font-weight: 700; color: #f8fafc;">${m.name}</span>
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
            <td style="text-align: center;">
              ${isCur ? 
                '<span style="color: #34d399; font-size: 0.8rem;">● 登入中</span>' : 
                `<button type="button" class="btn-switch-member" style="padding: 3px 8px; font-size: 0.72rem;" onclick="switchMemberDirectly('${m.id}')">切換登入</button>`
              }
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

function renderMemberCardHtml(m) {
  const isCur = m.id === currentMemberId;
  const isCadre = m.squadRole === '幹部';
  const isLeader = m.squadRole === '小隊長';
  const isDeputy = m.squadRole === '副小隊長';

  let cardClasses = 'roster-member-card';
  if (isCur) cardClasses += ' is-current';
  if (isCadre) cardClasses += ' cadre-card';
  if (isLeader) cardClasses += ' leader-card';
  if (isDeputy) cardClasses += ' deputy-card';

  let avatarGlow = '';
  if (isCadre) avatarGlow = 'glow-cadre';
  if (isLeader) avatarGlow = 'glow-leader';
  if (isDeputy) avatarGlow = 'glow-deputy';

  return `
    <div class="${cardClasses}">
      <div class="roster-card-top">
        <div class="roster-avatar ${avatarGlow}">
          ${m.avatar}
        </div>
        <div class="roster-name-group">
          <div class="roster-name-row">
            <span class="roster-name">${m.name}</span>
            ${renderRoleTagHtml(m)}
          </div>
          <div style="font-size: 0.72rem; color: var(--text-dim); margin-top: 2px;">
            ${m.squad || ''}・資歷 ${m.joined || '博館分隊'}
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

      <div class="roster-card-actions">
        ${isCur ? 
          `<button type="button" class="btn-switch-member active-login" disabled>
              <span>✅ 目前已登入中</span>
            </button>` :
          `<button type="button" class="btn-switch-member" onclick="switchMemberDirectly('${m.id}')">
              <span>👤 切換由此人登入</span>
            </button>`
        }
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
          renderAdminPasswordTrackingTable();
          showToast(`已成功將【${u}】密碼重設為預設 1234！`, '🔑');
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
  // 1. 全域快速填入掛載 (供登入視窗內的快捷按鈕使用)
  window.quickFillLogin = function(username, pwd) {
    const uInput = document.getElementById('inputLoginUsername');
    const pInput = document.getElementById('inputLoginPassword');
    if (uInput) uInput.value = username;
    if (pInput) pInput.value = pwd;
    pInput?.focus();
  };

  const modalLogin = document.getElementById('modalLogin');
  const modalFirst = document.getElementById('modalFirstChangePassword');
  const modalChange = document.getElementById('modalChangePassword');

  // 2. 開啟登入彈窗按鈕
  document.getElementById('btnOpenLoginModal')?.addEventListener('click', () => {
    modalLogin?.classList.add('open');
    document.getElementById('inputLoginUsername')?.focus();
  });

  // 3. 登出按鈕
  document.getElementById('btnLogout')?.addEventListener('click', () => {
    currentAuthUser = null;
    Store.set('current_auth_user', null);
    currentMemberId = null;
    Store.set('currentMemberId', null);
    updateUserNavbarUi();
    updateAllViews();
    modalLogin?.classList.add('open');
    showToast('您已成功安全登出系統！', '🚪');
  });

  // 4. 開啟自行變更密碼彈窗按鈕
  document.getElementById('btnOpenChangePassword')?.addEventListener('click', () => {
    if (!currentAuthUser) {
      showToast('請先登入系統方可變更密碼！', '⚠️');
      modalLogin?.classList.add('open');
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

  // 5. 登入表單提交處理
  document.getElementById('formLogin')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const uInput = document.getElementById('inputLoginUsername');
    const pInput = document.getElementById('inputLoginPassword');
    const username = uInput?.value.trim() || '';
    const password = pInput?.value.trim() || '';

    const allAccs = getUserAccounts();
    const matched = allAccs.find(a => a.username === username);

    if (!matched) {
      showToast('找不到此帳號，請確認中文姓名或代號是否正確！', '❌');
      playFeedbackSound('alert');
      uInput?.focus();
      return;
    }

    if (matched.password !== password) {
      showToast('密碼錯誤！隊員預設密碼為 1234，承辦人為 0000', '❌');
      playFeedbackSound('alert');
      pInput?.focus();
      return;
    }

    // 驗證成功！
    // 若為義消同仁且尚未變更過密碼 (密碼仍為 1234)：強制先改密碼
    if (!matched.isAdmin && !matched.hasChangedPassword) {
      tempPendingUser = matched;
      modalLogin?.classList.remove('open');
      
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

    // 登入完成 (已變更過密碼，或警消承辦人)
    currentAuthUser = matched;
    Store.set('current_auth_user', currentAuthUser);
    currentMemberId = matched.memberId;
    Store.set('currentMemberId', currentMemberId);

    modalLogin?.classList.remove('open');
    updateUserNavbarUi();
    updateAllViews();
    playFeedbackSound('success');
    showToast(`登入成功！歡迎【${matched.name}】${matched.isAdmin ? '管理長官' : '同仁'}進入系統`, matched.isAdmin ? '👮‍♂️' : '👨‍🚒');
  });

  // 6. 首次登入強制變更密碼提交處理
  document.getElementById('formFirstChangePassword')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!tempPendingUser) {
      modalFirst?.classList.remove('open');
      modalLogin?.classList.add('open');
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
    }

    // 轉為正式登入
    currentAuthUser = tempPendingUser;
    Store.set('current_auth_user', currentAuthUser);
    currentMemberId = currentAuthUser.memberId;
    Store.set('currentMemberId', currentMemberId);
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
    }

    modalChange?.classList.remove('open');
    updateUserNavbarUi();
    updateAllViews();
    playFeedbackSound('success');
    showToast('個人密碼已成功變更，請妥善保管！', '🔐');
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
  setupExcelExport();
  setupDeviceToggle();
  setupCalendarControls();
  setupTabs();
  setupRosterControls();
  startClock();
  initSupabase();
  updateUserNavbarUi();
  updateAllViews();
  if (!currentAuthUser) {
    document.getElementById('modalLogin')?.classList.add('open');
  }
});

