import { INITIAL_MEMBERS, INITIAL_ATTENDANCE, INITIAL_DISPATCHES, INITIAL_SHIFTS, BADGE_DEFINITIONS } from './data.js';

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

let members = Store.get('members', INITIAL_MEMBERS);
let attendance = Store.get('attendance', INITIAL_ATTENDANCE).map(a => {
  if (a.note && (a.note.includes('91車') || a.note.includes('92車'))) {
    return { ...a, note: a.note.replace(/9[12]車/g, '救護協勤') };
  }
  return a;
});
Store.set('attendance', attendance);
let dispatches = Store.get('dispatches', INITIAL_DISPATCHES);
let shifts = Store.get('shifts', INITIAL_SHIFTS).map(s => {
  let v = s.vehicle;
  if (!v || v === '博館91' || v === '博館92' || v.includes('91') || v.includes('92')) {
    v = '救護協勤';
  }
  return { ...s, vehicle: v };
});
Store.set('shifts', shifts);
let currentMemberId = Store.get('currentMemberId', 'm1');
let activeDuty = Store.get('activeDuty', null); // { memberId, startTime: timestamp, dateStr }

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
      shifts = remoteShifts.map(s => {
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
  return members.find(m => m.id === currentMemberId) || members[0];
}

function initMemberSelector() {
  const select = document.getElementById('memberSelect');
  const modalMemberSelect = document.getElementById('inputDispatchMember');
  
  select.innerHTML = '';
  modalMemberSelect.innerHTML = '';
  
  members.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.name} (${m.level})`;
    if (m.id === currentMemberId) opt.selected = true;
    select.appendChild(opt);

    const opt2 = document.createElement('option');
    opt2.value = m.name;
    opt2.textContent = `${m.name} (${m.level})`;
    modalMemberSelect.appendChild(opt2);
  });

  select.addEventListener('change', (e) => {
    currentMemberId = e.target.value;
    Store.set('currentMemberId', currentMemberId);
    updateAllViews();
    showToast(`已切換至隊員：${getCurrentMember().name}`, '👤');
  });
}

function updateDutyHero() {
  const cur = getCurrentMember();
  document.getElementById('currentMemberRoleBadge').textContent = `⭐ ${cur.level}`;
  
  const statusPill = document.getElementById('dutyStatusPill');
  const statusText = document.getElementById('dutyStatusText');
  const btnIn = document.getElementById('btnPunchIn');
  const btnOut = document.getElementById('btnPunchOut');
  
  // 檢查當前隊員是否在隊協勤中
  const isOnDuty = activeDuty && activeDuty.memberId === cur.id;

  if (isOnDuty) {
    statusPill.className = 'status-pill';
    statusText.textContent = `協勤值勤中 (博館駐地)`;
    btnIn.disabled = true;
    btnOut.disabled = false;
  } else {
    statusPill.className = 'status-pill offline';
    statusText.textContent = `尚未簽到 (離隊)`;
    btnIn.disabled = false;
    btnOut.disabled = true;
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
  tbody.innerHTML = '';

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
    `;
    tbody.appendChild(tr);
  });
}

// 救護出勤紀錄簿卡片列表
function renderDispatchList() {
  const container = document.getElementById('dispatchCardsList');
  const search = document.getElementById('searchDispatchInput').value.toLowerCase().trim();
  const filterVehicle = document.getElementById('filterVehicleSelect').value;
  const filterTag = document.getElementById('filterTagSelect').value;

  container.innerHTML = '';

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
        <div style="display: flex; align-items: center; gap: 0.65rem;">
          <span class="case-id-tag">${d.caseNo}</span>
          <span class="vehicle-pill ${vehicleClass}">${d.vehicle}</span>
          <span style="font-weight: 600; font-size: 0.95rem;">${d.resultType}</span>
          ${d.specialTag ? `<span style="background: rgba(245,158,11,0.2); color: #fbbf24; border: 1px solid rgba(245,158,11,0.4); font-size: 0.75rem; padding: 2px 8px; border-radius: 99px; font-weight: 700;">${d.specialTag}</span>` : ''}
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
}

// 榮譽徽章牆渲染
function renderBadges() {
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

const WEEKDAYS_MAP = {
  1:'四', 2:'五', 3:'六', 4:'日', 5:'一', 6:'二', 7:'三',
  8:'四', 9:'五', 10:'六', 11:'日', 12:'一', 13:'二', 14:'三',
  15:'四', 16:'五', 17:'六', 18:'日', 19:'一', 20:'二', 21:'三',
  22:'四', 23:'五', 24:'六', 25:'日', 26:'一', 27:'二', 28:'三',
  29:'四', 30:'五', 31:'六'
};

function populateShiftDatesDropdown() {
  const select = document.getElementById('inputShiftDate');
  if (!select) return;
  select.innerHTML = '';
  for (let d = 1; d <= 31; d++) {
    const dayStr = String(d).padStart(2, '0');
    const w = WEEKDAYS_MAP[d] || '';
    const isHoliday = d === 10 ? ' (國慶日 ⭐)' : '';
    const opt = document.createElement('option');
    opt.value = `115-10-${dayStr}`;
    opt.textContent = `115-10-${dayStr} (${w})${isHoliday}`;
    if (d === 7) opt.selected = true;
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

  // 2. 115年10月1日為週四 (Sunday=0, Thursday=4, 前面補 4 格上個月空白)
  for (let p = 0; p < 4; p++) {
    const padCell = document.createElement('div');
    padCell.className = 'calendar-day-cell other-month';
    padCell.innerHTML = `<div class="calendar-day-header"><span class="calendar-day-num" style="opacity: 0.3;">${27 + p}</span></div>`;
    grid.appendChild(padCell);
  }

  // 3. 生成 1~31 日期儲存格
  let statTotal = 0;
  let statEms = 0;
  let statDesk = 0;
  let statVacant = 0;

  for (let d = 1; d <= 31; d++) {
    const dayStr = String(d).padStart(2, '0');
    const dateKey = `115-10-${dayStr}`;
    const dayOfWeek = WEEKDAYS_MAP[d];
    const isWeekend = dayOfWeek === '六' || dayOfWeek === '日';
    const isToday = d === 7; // 模擬當前日期為 10/7
    const isNationalDay = d === 10;

    // 取得當天所有班次
    let dayShifts = shifts.filter(s => s.date === dateKey || s.day === d);

    // 統計全月數據 (未過濾前)
    dayShifts.forEach(s => {
      statTotal++;
      if (s.vehicle.includes('值班')) statDesk++;
      else statEms++;
      if (!s.memberName || s.status === '缺協勤') statVacant++;
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
    if (calFilterVacantOnly) {
      visibleShifts = visibleShifts.filter(s => !s.memberName || s.status === '缺協勤');
    }

    const hasVacant = dayShifts.some(s => !s.memberName || s.status === '缺協勤');
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

    if (hasVacant) {
      badgeHtml += `<span class="cal-vacant-indicator">⚠️ 缺額</span>`;
    }

    // 班次晶片區 (最多直接展示 3 條，其餘 +N)
    let chipsHtml = '';
    const maxChips = 3;
    visibleShifts.slice(0, maxChips).forEach(s => {
      const isVac = !s.memberName || s.status === '缺協勤';
      const isMine = s.memberName === curUser.name;
      const isDesk = s.vehicle.includes('值班');
      const chipClass = isVac ? 'chip-vacant' : (isDesk ? 'chip-desk' : 'chip-ems');
      const vLabel = isDesk ? (s.vehicle.includes('補定訓') ? '補定訓' : '值班') : '救護待命';
      const text = isVac ? `⚠️ 缺 ${vLabel} ${s.period}` : `${vLabel} ${s.memberName} ${s.period}`;
      
      chipsHtml += `
        <div class="cal-shift-chip ${chipClass} ${isMine ? 'is-mine' : ''}" title="${vLabel} ${s.period} ${s.memberName || '缺協勤'}">
          ${text}
        </div>
      `;
    });

    if (visibleShifts.length > maxChips) {
      chipsHtml += `<div class="cal-more-shifts-tag">+${visibleShifts.length - maxChips} 班...</div>`;
    } else if (visibleShifts.length === 0 && dayShifts.length > 0 && calFilterVacantOnly) {
      chipsHtml += `<div style="font-size: 0.7rem; color: var(--text-dim); margin-top: 4px;">無缺額班次</div>`;
    }

    cell.innerHTML = `
      <div class="calendar-day-header">
        <span class="calendar-day-num">${d}</span>
        <div style="display: flex; gap: 4px;">${badgeHtml}</div>
      </div>
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

// 判斷當前登入者是否具備小隊幹部權限
function isCurrentOfficer() {
  const m = getCurrentMember();
  if (!m) return false;
  return m.role.includes('幹部') || m.role.includes('小隊長') || m.role.includes('助理') || 
         m.name === '林振傑' || m.name === '張宥安' || m.name === '彭凱琳';
}

// 取得特定隊員未完成/未來的預約班次數量 (>= CURRENT_SYSTEM_DATE)
function getMemberFutureShifts(memberName) {
  return shifts.filter(s => s.memberName === memberName && s.date >= CURRENT_SYSTEM_DATE && s.status !== '缺席');
}

// 時間解析器：把 "08:00-12:00" 或 "08:00~12:00" 轉為自午夜起的 startMin, endMin
function parseTimePeriod(periodStr) {
  if (!periodStr) return { startMin: 0, endMin: 0, valid: false };
  const parts = periodStr.split(/[~-]/);
  if (parts.length !== 2) return { startMin: 0, endMin: 0, valid: false };
  const [sh, sm] = parts[0].trim().split(':').map(Number);
  const [eh, em] = parts[1].trim().split(':').map(Number);
  const startMin = (sh || 0) * 60 + (sm || 0);
  const endMin = (eh || 0) * 60 + (em || 0);
  return { startMin, endMin, valid: !isNaN(startMin) && !isNaN(endMin) && endMin > startMin };
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

// 驗證預約規則
// 返回 { ok: boolean, reason: string }
function validateShiftBooking(targetMember, date, vehicle, period, shiftType, ignoreShiftId = null, isOfficerOverride = false) {
  // 1. 服勤時間檢查 (07:00 ~ 23:00)
  const timeInfo = parseTimePeriod(period);
  if (!timeInfo.valid || !isWithinAllowedHours(timeInfo.startMin, timeInfo.endMin)) {
    return { 
      ok: false, 
      reason: '【服勤時間不合規範】\n依分隊協勤規定：可服勤時間僅限 07:00 至 23:00 之間！夜間 23:00 後至清晨 07:00 前不開放協勤填寫。' 
    };
  }

  // 2. 管制期檢查 (階段二處分鎖定)
  if (targetMember.isRestricted && !isOfficerOverride) {
    return {
      ok: false,
      reason: `⛔【處分管制中・禁止自行填班】\n隊員：${targetMember.name}\n管制期限：至 ${targetMember.restrictionUntil || '115-12-07'} 止（自刪除日起2個月）\n\n處分原因：超過三班且屬故意累犯，依規定於管制期內「無法自行填班，需透過小隊幹部填寫班表」！\n\n⚠️ 重大警告：管制期內如自行填班，將提請幹部會議開會討論決議是否依《義勇消防組織編組訓練演習服勤辦法》第八條第一項第7款予以解聘！\n請直接洽詢分隊幹部協助填寫。`
    };
  }

  // 3. 每人預約上限最多 3 班 (含跨月)
  const currentFuture = getMemberFutureShifts(targetMember.name).filter(s => s.id !== ignoreShiftId);
  if (currentFuture.length >= 3 && !isOfficerOverride) {
    return {
      ok: false,
      reason: `⚠️【預約額度已達上限】\n每位同仁每次預約上限最多 3 班（含跨月）！\n您目前已有 ${currentFuture.length} 班未協勤班次：\n${currentFuture.map(s => `• ${s.date} (${s.vehicle.includes('值班') ? s.vehicle : '救護協勤'} ${s.period})`).join('\n')}\n\n需待協勤完畢一班後，方可再往後填寫一班！`
    };
  }

  // 4. 補定訓特定檢驗規則
  const isMakeup = vehicle.includes('補定訓') || shiftType.includes('補定訓');
  if (isMakeup) {
    // 檢查是否曾臨時取消而被視為缺席
    if (targetMember.makeupTrainingStatus === 'cancelled_absent') {
      return {
        ok: false,
        reason: '⛔【不得再補值班】\n依分隊值班注意事項第 2 點規定：補定訓如已登記於值班欄位，臨時取消視為「缺席定訓」，亦不可再次補值班！'
      };
    }
    // 補定訓每次必須剛好 4 小時
    const durationHours = (timeInfo.endMin - timeInfo.startMin) / 60;
    if (durationHours !== 4) {
      return {
        ok: false,
        reason: `【補定訓時數限制】\n依分隊值班注意事項第 2 點：補定訓改為值值班台，每次固定為 4 小時！您選擇的時段為 ${durationHours} 小時。`
      };
    }
  }

  // 5. 同一時段人數上限檢驗
  const sameDayShifts = shifts.filter(s => s.date === date && s.id !== ignoreShiftId && s.memberName && s.status !== '缺席');
  const overlappingShifts = sameDayShifts.filter(s => isTimeOverlap(s.period, period));

  // (A) 救護班 (分隊待命協勤)：同時段最多 4 位同仁，哪台車出勤就隨車出勤
  const isEms = !vehicle.includes('值班');
  if (isEms) {
    const overlappingEms = overlappingShifts.filter(s => !s.vehicle.includes('值班'));
    if (overlappingEms.length >= 4) {
      return {
        ok: false,
        reason: `⚠️【救護協勤待命額滿】\n分隊規定：同一時段最多 4 位同仁於隊上待命協勤（哪台車出勤即隨車出勤）！\n該時段已有 4 位同仁待命：\n${overlappingEms.map(s => `• ${s.memberName} (${s.period})`).join('\n')}\n請選擇其他時段。`
      };
    }
  }

  // (B) 值班台 (含一般值班、補定訓)：同時段僅限 1 位同仁
  const isDesk = vehicle.includes('值班') || shiftType.includes('值班') || isMakeup;
  if (isDesk) {
    const overlappingDesk = overlappingShifts.filter(s => s.vehicle.includes('值班') || s.shiftType.includes('值班') || s.vehicle.includes('補定訓'));
    if (overlappingDesk.length >= 1) {
      return {
        ok: false,
        reason: `⚠️【值班台額滿】\n分隊規定：同一時段值班人員僅能 1 人（補定訓亦僅限 1 位）！\n該時段已有同仁值班：${overlappingDesk[0].memberName} (${overlappingDesk[0].period})。\n請選擇其他時段。`
      };
    }
  }

  // (C) 個人防重複檢驗：避免同仁自己同一時段排兩班
  const mySelfOverlap = overlappingShifts.find(s => s.memberName === targetMember.name);
  if (mySelfOverlap) {
    const vName = mySelfOverlap.vehicle.includes('值班') ? mySelfOverlap.vehicle : '救護待命';
    return {
      ok: false,
      reason: `⚠️【時段衝突】\n您在該時段已有預約班次：${vName} (${mySelfOverlap.period})！\n請勿同一時段重複登記。`
    };
  }

  return { ok: true };
}

// 雲端刪除與取消協勤功能 (釋出名額)
function cancelShift(shiftId) {
  const shift = shifts.find(s => s.id === shiftId);
  if (!shift) return;
  const cur = getCurrentMember();
  const isOfficer = isCurrentOfficer();

  // 權限檢查：本人或幹部
  if (shift.memberName !== cur.name && !isOfficer) {
    alert('非本人或小隊幹部無法取消此班次！');
    return;
  }

  const isMakeup = (shift.vehicle && shift.vehicle.includes('補定訓')) || (shift.shiftType && shift.shiftType.includes('補定訓'));

  if (isMakeup) {
    const confirmMakeup = confirm(
      `⚠️【值班注意事項重大警告】\n依分隊規定：\n「補定訓改為值值班台，每次四小時，如已登記補定訓於值班欄位，臨時取消，視為缺席定訓，亦不可再次補值班！」\n\n您確定要取消 ${shift.date} 的補定訓班次嗎？\n（確認後將註記為缺席定訓，且本期無法再次登記補值班）`
    );
    if (!confirmMakeup) return;

    // 標記隊員狀態為缺席定訓
    const targetMem = members.find(m => m.name === shift.memberName);
    if (targetMem) {
      targetMem.makeupTrainingStatus = 'cancelled_absent';
      Store.set('members', members);
    }
  } else {
    const vDisplay = shift.vehicle && shift.vehicle.includes('值班') ? shift.vehicle : '救護協勤 (隊上待命)';
    const confirmNormal = confirm(
      `確定要於雲端取消 ${shift.date} (${vDisplay} ${shift.period}) 的協勤預約嗎？\n\n取消後將釋出此名額供其他同仁認領，並退回您的 1 班預約額度。`
    );
    if (!confirmNormal) return;
  }

  const prevMember = shift.memberName;
  shift.memberName = '';
  shift.status = '缺協勤';
  Store.set('shifts', shifts);
  pushShiftToSupabase(shift);

  updateAllViews();
  showToast(`已成功取消【${prevMember}】的預約，該班次名額已於雲端即時釋出！`, '🔄');
  playFeedbackSound('success');
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
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 綁定幹部事件
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
        excess.forEach(s => {
          s.memberName = '';
          s.status = '缺協勤';
          deletedCount++;
        });
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
      const modal = document.getElementById('modalClaimShift');
      document.getElementById('inputShiftMemberName').value = name;
      modal.setAttribute('data-officer-proxy', 'true');
      modal.classList.add('open');
      showToast(`已進入【幹部代填模式】（代表隊員：${name} 填表）`, '👮');
    });
  });
}

// 點擊開啟單日排班詳細彈窗
function openDayDetailModal(day) {
  const modal = document.getElementById('modalDayDetail');
  const dayStr = String(day).padStart(2, '0');
  const dateKey = `115-10-${dayStr}`;
  const weekday = WEEKDAYS_MAP[day] || '';
  const dayShifts = shifts.filter(s => s.date === dateKey || s.day === day);
  const curUser = getCurrentMember();
  const isOfficer = isCurrentOfficer();

  document.getElementById('dayDetailTitle').textContent = `📅 115年10月${dayStr}日 (週${weekday}) 排班詳情`;
  document.getElementById('dayDetailSub').textContent = `博館分隊 救護待命與值班台協勤 ｜ 當日共 ${dayShifts.length} 班次`;

  const container = document.getElementById('dayDetailShiftsList');
  container.innerHTML = '';

  if (dayShifts.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">本日尚無任何同仁登記排班，歡迎登記首發！</div>`;
  } else {
    dayShifts.forEach(s => {
      const isVac = !s.memberName || s.status === '缺協勤';
      const isMine = s.memberName === curUser.name;
      const isDesk = s.vehicle.includes('值班');
      const vClass = isDesk ? 'v-desk' : 'v-ems';
      const vDisplay = isDesk ? s.vehicle : '🚑 救護協勤 (隊上待命)';

      const card = document.createElement('div');
      card.style.cssText = `
        background: rgba(30, 41, 59, 0.6);
        border: 1px solid ${isVac ? 'rgba(239,68,68,0.5)' : (isMine ? 'rgba(245,158,11,0.5)' : 'var(--border-subtle)')};
        border-radius: 12px;
        padding: 0.85rem 1.1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
      `;

      let actionHtml = '';
      if (isVac) {
        actionHtml = `<button class="btn-claim-shift" data-shift-id="${s.id}" style="padding: 0.45rem 1rem; font-size: 0.82rem;">🙋‍♂️ 我要認領此班</button>`;
      } else if (isMine || isOfficer) {
        actionHtml = `
          <button class="btn-secondary btn-cancel-shift" data-shift-id="${s.id}" style="padding: 0.35rem 0.85rem; font-size: 0.78rem; color: #f87171; border-color: rgba(239,68,68,0.4); background: rgba(239,68,68,0.08);">
            ❌ 取消/釋出名額
          </button>
        `;
      } else {
        actionHtml = `<span style="font-size: 0.8rem; color: var(--text-muted); background: rgba(255,255,255,0.05); padding: 4px 10px; border-radius: 99px;">已排定</span>`;
      }

      card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span class="vehicle-pill ${vClass}">${vDisplay}</span>
          <div>
            <div style="font-family: var(--font-display); font-weight: 700; font-size: 1.05rem;">
              ${s.period}
              <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500; margin-left: 6px;">(${s.shiftType})</span>
            </div>
            <div style="font-size: 0.85rem; color: ${isVac ? '#f87171' : '#38bdf8'}; font-weight: 600; margin-top: 2px;">
              ${isVac ? '⚠️ 缺協勤人員 (等待認領中)' : `👨‍🚒 協勤人員：${s.memberName} ${isMine ? '★ (您本人)' : ''}`}
            </div>
          </div>
        </div>

        <div>
          ${actionHtml}
        </div>
      `;
      container.appendChild(card);
    });
  }

  // 綁定認領事件 (套用規則檢驗)
  container.querySelectorAll('.btn-claim-shift').forEach(btn => {
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
      openDayDetailModal(day);
      updateAllViews();
      const vDisplay = shift.vehicle && shift.vehicle.includes('值班') ? shift.vehicle : '救護待命';
      showToast(`成功認領 10月${dayStr}日 (${vDisplay} ${shift.period})！`, '🎉');
      playFeedbackSound('success');
    });
  });

  // 綁定取消事件 (雲端刪除修正)
  container.querySelectorAll('.btn-cancel-shift').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const shiftId = e.target.getAttribute('data-shift-id');
      cancelShift(shiftId);
      openDayDetailModal(day);
    });
  });

  // 設定新增按鈕快速帶入這一天
  const btnAdd = document.getElementById('btnDayDetailAddShift');
  if (btnAdd) {
    btnAdd.onclick = () => {
      modal.classList.remove('open');
      const selectDate = document.getElementById('inputShiftDate');
      if (selectDate) selectDate.value = dateKey;
      document.getElementById('inputShiftMemberName').value = getCurrentMember().name;
      document.getElementById('modalClaimShift')?.classList.add('open');
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

  let list = shifts;
  if (filterVehicle !== 'ALL') {
    if (filterVehicle === '救護協勤') {
      list = list.filter(s => !s.vehicle.includes('值班'));
    } else if (filterVehicle === '值班台') {
      list = list.filter(s => s.vehicle.includes('值班'));
    } else {
      list = list.filter(s => s.vehicle === filterVehicle);
    }
  }
  if (calFilterVacantOnly) {
    list = list.filter(s => !s.memberName || s.status === '缺協勤');
  }

  list.forEach(s => {
    const tr = document.createElement('tr');
    const isVacant = !s.memberName || s.status === '缺協勤';
    const isMine = s.memberName === curUser.name;
    const isDesk = s.vehicle.includes('值班');
    const vClass = isDesk ? 'v-desk' : 'v-ems';
    const vDisplay = isDesk ? s.vehicle : '🚑 救護協勤 (隊上待命)';
    
    let actionBtnHtml = '';
    if (isVacant) {
      actionBtnHtml = `<button class="btn-claim-shift" data-shift-id="${s.id}">認領此班</button>`;
    } else if (isMine || isOfficer) {
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
        ${isVacant 
          ? '<span style="color: #ef4444; font-weight: 700;">⚠️ 尚無人員 (缺額)</span>' 
          : `<span style="color: #38bdf8; font-weight: 600;">${s.memberName} ${isMine ? '★' : ''}</span>`}
      </td>
      <td>
        <span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 99px; ${isVacant ? 'background: rgba(239,68,68,0.2); color: #f87171;' : 'background: rgba(16,185,129,0.15); color: #34d399;'}">
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
    showToast('目前展示示範月份：民國 115 年 10 月', 'ℹ️');
  });
  document.getElementById('btnNextMonth')?.addEventListener('click', () => {
    showToast('目前展示示範月份：民國 115 年 10 月', 'ℹ️');
  });
  document.getElementById('btnTodayMonth')?.addEventListener('click', () => {
    showToast('已跳轉回本月 (115年10月)', '📅');
    renderVisualCalendar();
  });
}

function renderSchedule() {
  renderVisualCalendar();
  renderScheduleListView();
  updatePersonalQuotaUI();
  renderOfficerAuditPanel();
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
        </td>
      `;
      tbody.appendChild(tr);
    });
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
  updateDutyHero();
  updatePersonalSummary();
  renderRecentAttendance();
  renderDispatchList();
  renderBadges();
  renderSchedule();
  renderSummaryReports();
  renderOfficerExecutiveDashboard();
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
      const elapsedMs = Date.now() - activeDuty.startTime;
      const totalSec = Math.floor(elapsedMs / 1000);
      const hrs = String(Math.floor(totalSec / 3600)).padStart(2, '0');
      const mins = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const secs = String(totalSec % 60).padStart(2, '0');
      document.getElementById('dutyTimerDisplay').textContent = `${hrs}:${mins}:${secs}`;
    }
  }, 1000);
}

function setupPunchEvents() {
  const btnIn = document.getElementById('btnPunchIn');
  const btnOut = document.getElementById('btnPunchOut');

  btnIn.addEventListener('click', () => {
    const cur = getCurrentMember();
    activeDuty = {
      memberId: cur.id,
      memberName: cur.name,
      startTime: Date.now(),
      dateStr: '115-10-07',
      timeStr: new Date().toTimeString().substring(0, 5)
    };
    Store.set('activeDuty', activeDuty);
    updateDutyHero();
    playFeedbackSound('success');
    showToast(`簽到成功！${cur.name} 已在博館分隊開始值班協勤`, '📍');
  });

  btnOut.addEventListener('click', () => {
    if (!activeDuty) return;
    const cur = getCurrentMember();
    const durationHours = Math.max(1, Math.round(((Date.now() - activeDuty.startTime) / 3600000) * 10) / 10);
    const signOutTime = new Date().toTimeString().substring(0, 5);

    // 新增簽到退紀錄
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
      note: '即時手機打卡協勤'
    };

    attendance.push(newAtt);
    Store.set('attendance', attendance);

    // 更新成員累計時數
    cur.totalHours = (Number(cur.totalHours) || 0) + durationHours;
    Store.set('members', members);

    activeDuty = null;
    Store.set('activeDuty', null);

    updateAllViews();
    playFeedbackSound('success');
    showToast(`簽退完成！本日協勤時數 ${durationHours} 小時已存入系統`, '🏁');
  });
}

// ==========================================
// 5. 救護出勤登記 Form 與 Modal
// ==========================================
function setupModals() {
  const modalDispatch = document.getElementById('modalNewDispatch');
  const modalClaim = document.getElementById('modalClaimShift');

  // 開啟出勤 Modal
  document.getElementById('btnOpenNewDispatchModal')?.addEventListener('click', () => {
    document.getElementById('inputCaseNo').value = `1151007-${String(dispatches.length + 1).padStart(2, '0')}`;
    document.getElementById('inputDispatchMember').value = getCurrentMember().name;
    modalDispatch.classList.add('open');
  });

  document.getElementById('btnNewDispatchHeader')?.addEventListener('click', () => {
    document.getElementById('inputCaseNo').value = `1151007-${String(dispatches.length + 1).padStart(2, '0')}`;
    document.getElementById('inputDispatchMember').value = getCurrentMember().name;
    modalDispatch.classList.add('open');
  });

  // 更新排班 Modal 內的個人額度即時提示
  function updateModalQuotaPreview(targetMem) {
    const quotaNotice = document.getElementById('modalQuotaNotice');
    if (!quotaNotice) return;
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

  // 監聽勤務類別變更 (連動補定訓警語與預設值)
  const selectCat = document.getElementById('inputShiftCategory');
  const alertMakeup = document.getElementById('makeupTrainingAlertBox');
  const selectType = document.getElementById('inputShiftType');
  const selectPeriod = document.getElementById('inputShiftPeriod');

  selectCat?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val.includes('補定訓')) {
      if (alertMakeup) alertMakeup.style.display = 'block';
      if (selectType) selectType.value = '補定訓';
      // 確保時段為 4 小時
      if (selectPeriod && selectPeriod.value === '18:00-23:00') {
        selectPeriod.value = '18:00-22:00';
      }
    } else {
      if (alertMakeup) alertMakeup.style.display = 'none';
      if (selectType) selectType.value = val.includes('值班') ? '幹部值班' : '自排班';
    }
  });

  // 開啟認領 Modal (附帶資格預檢)
  function openClaimModalWithCheck(isProxy = false, proxyMemberName = null) {
    const cur = getCurrentMember();
    const isOfficer = isCurrentOfficer();
    let targetMem = cur;

    if (isProxy && proxyMemberName) {
      targetMem = members.find(m => m.name === proxyMemberName) || cur;
      modalClaim.setAttribute('data-officer-proxy', 'true');
    } else {
      modalClaim.removeAttribute('data-officer-proxy');
      // 非幹部代填時，檢查本人是否受管制
      if (cur.isRestricted && !isOfficer) {
        alert(
          `⛔【處分管制中・禁止自行填班】\n隊員：${cur.name}\n管制期限：至 ${cur.restrictionUntil || '115-12-07'} 止（自處分日起2個月）\n\n處分原因：超過三班且屬故意累犯，依規定「無法自行填班，需透過小隊幹部填寫班表」！\n\n⚠️ 重大警告：管制期內如自行填班，將提請幹部會議依《義勇消防組織編組訓練演習服勤辦法》第八條第一項第7款予以解聘！`
        );
        return;
      }
      // 檢查本人額度是否已滿
      const futureShifts = getMemberFutureShifts(cur.name);
      if (futureShifts.length >= 3 && !isOfficer) {
        alert(
          `⚠️【預約額度已達上限】\n每位同仁每次預約上限最多 3 班（含跨月）！\n您目前已有 3 班未協勤班次，需待協勤完畢一班後，方可再往後填寫！`
        );
        return;
      }
    }

    document.getElementById('inputShiftMemberName').value = targetMem.name;
    updateModalQuotaPreview(targetMem);
    modalClaim.classList.add('open');
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

  // 表單 1: 新增出勤案件
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

  // 表單 2: 自排班登記 (嚴格套用所有排班法規驗證)
  document.getElementById('formClaimShift')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const date = document.getElementById('inputShiftDate').value;
    const catVal = document.getElementById('inputShiftCategory').value;
    const period = document.getElementById('inputShiftPeriod').value;
    const shiftType = document.getElementById('inputShiftType').value;
    const memberName = document.getElementById('inputShiftMemberName').value;
    const isProxy = modalClaim.getAttribute('data-officer-proxy') === 'true';

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

    const dayNum = Number(date.split('-')[2]) || 7;
    const newShift = {
      id: `s-${Date.now()}`,
      date,
      day: dayNum,
      dayOfWeek: WEEKDAYS_MAP[dayNum] || '登記班',
      vehicle,
      period,
      memberName: targetMember.name,
      status: '已排班',
      shiftType,
      isMakeupTraining: catVal.includes('補定訓')
    };

    shifts.push(newShift);
    Store.set('shifts', shifts);
    pushShiftToSupabase(newShift);

    modalClaim.removeAttribute('data-officer-proxy');
    modalClaim.classList.remove('open');
    updateAllViews();
    playFeedbackSound('success');
    showToast(`排班成功！${targetMember.name} 於 ${date} (${vehicle} ${period}) 已登記完成`, '🎉');
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

  // 支援網址直接帶入 Hash (例如: #tab-officer-dashboard) 直接開啟長官列管圖
  const initHash = window.location.hash.replace('#', '');
  if (initHash) {
    const targetBtn = document.querySelector(`.tab-btn[data-tab="${initHash}"]`);
    if (targetBtn) {
      setTimeout(() => targetBtn.click(), 50);
    }
  }

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
// 初始化執行
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  initMemberSelector();
  populateShiftDatesDropdown();
  setupPunchEvents();
  setupModals();
  setupExcelExport();
  setupDeviceToggle();
  setupCalendarControls();
  setupTabs();
  startClock();
  initSupabase();
  updateAllViews();
});

