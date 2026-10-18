const STORAGE_KEY = 'han-kki-records-v1';
const MODES = ['집에서 먹음', '외식', '먹지 않음'];
const PREP_METHODS = ['직접 조리', '밀키트·냉동식품', '남은 음식', '배달·포장'];
const PREPARERS = ['아내', '남편'];
const CLEANUP_OPTIONS = ['아내', '남편', '함께', '아직 안 함', '설거지 없음'];
const ALCOHOL_KEY = 'meal-log-alcohol-v1';
const MEAL_NAMES = { breakfast: '아침', lunch: '점심', dinner: '저녁' };
const CALENDAR_MEALS = ['breakfast', 'lunch', 'dinner'];
const CALENDAR_LETTERS = { breakfast: 'B', lunch: 'L', dinner: 'D' };
const QUICK_BREAKFASTS = ['과일주스', '삶은 계란'];
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let records = loadRecords();
let selectedDate = toISO(new Date());
let calendarMonth = new Date();
let calendarDate = selectedDate;
let calendarDateOpened = false;
let alcoholLogs = loadAlcoholLogs();
let summaryRange = 'week';
let summaryTab = 'meals';
let draftMemberDetails = {};
const cloudConfig = window.MEALLOG_SUPABASE_CONFIG || {};
const supabaseClient = cloudConfig.url && cloudConfig.publishableKey && window.supabase?.createClient
  ? window.supabase.createClient(cloudConfig.url, cloudConfig.publishableKey)
  : null;
let cloudUserId = null;
let cloudWrites = Promise.resolve();
let loadingCloud = false;

function normalizePrep(value) {
  if (['배달', '포장', '배달·포장'].includes(value)) return '배달·포장';
  if (value === '남은 음식') return '남은 음식';
  return ['밀키트', '냉동·간편식', '간편식 활용', '사온 음식', '밀키트·냉동식품'].includes(value) ? '밀키트·냉동식품' : '직접 조리';
}
function normalizeDish(dish, oldPrep = '직접 조리') {
  const name = typeof dish === 'string' ? dish : dish?.name || '';
  const prep = normalizePrep(typeof dish === 'string' ? oldPrep : dish?.prep);
  if (['남은 음식', '배달·포장'].includes(prep)) return { name, prep, preparedBy: '' };
  const oldPreparer = typeof dish === 'string' ? '' : dish?.preparedBy === '나' ? '아내' : dish?.preparedBy;
  return { name, prep, preparedBy: oldPreparer === '함께' ? '함께' : PREPARERS.includes(oldPreparer) ? oldPreparer : '아내' };
}
function loadAlcoholLogs() { try { return JSON.parse(localStorage.getItem(ALCOHOL_KEY) || '{}'); } catch { return {}; } }
function persistAlcoholLogs() { localStorage.setItem(ALCOHOL_KEY, JSON.stringify(alcoholLogs)); syncCloud(); }
function loadRecords() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    for (const record of Object.values(stored)) {
      if (record.mode === '집에서 해먹음' || record.mode === '사서 집에서 먹음') record.mode = '집에서 먹음';
      if (record.mode === '외식·배달') record.mode = '외식';
      if (Array.isArray(record.dishes)) record.dishes = record.dishes.map(dish => normalizeDish(dish, record.prep));
    }
    return stored;
  } catch { return {}; }
}
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); renderAll(); syncCloud(); }
function syncCloud() {
  if (!supabaseClient || !cloudUserId || loadingCloud) return;
  const snapshot = { user_id: cloudUserId, records, alcohol_logs: alcoholLogs, updated_at: new Date().toISOString() };
  cloudWrites = cloudWrites.then(async () => {
    const { error } = await supabaseClient.from('meallog_data').upsert(snapshot, { onConflict: 'user_id' });
    if (error) throw error;
    if (cloudUserId === snapshot.user_id) $('#account-status').textContent = '동기화 완료';
  }).catch(error => {
    console.error('MealLog cloud sync failed', error);
    $('#account-status').textContent = '동기화 실패';
    $('#account-message').textContent = '인터넷 연결을 확인해 주세요. 이 기기에는 기록이 저장되어 있어요.';
  });
}
function setAccountSignedIn(user) {
  cloudUserId = user?.id || null;
  if (supabaseClient) {
    $('#auth-gate').classList.toggle('hidden', Boolean(user));
    $('#app-shell').classList.toggle('hidden', !user);
    if (!user) $('#auth-message').textContent = '계정에 로그인하면 저장된 기록을 불러옵니다.';
  }
  $('#account-form').classList.toggle('hidden', Boolean(user));
  $('#account-sign-out').classList.toggle('hidden', !user);
  $('#account-status').textContent = user ? '동기화 중' : (supabaseClient ? '로그인 필요' : '이 기기에 저장 중');
  $('#account-message').textContent = user
    ? `${user.email} 계정에 기록을 저장하고 있어요.`
    : (supabaseClient ? '같은 계정으로 로그인한 기기끼리 기록을 공유해요.' : 'Supabase 설정 후 로그인하면 기기 간 기록을 동기화할 수 있어요.');
}
async function loadCloudData(user) {
  if (!supabaseClient || !user || cloudUserId === user.id && loadingCloud) return;
  loadingCloud = true;
  let shouldSeedCloud = false;
  cloudUserId = user.id;
  $('#account-status').textContent = '기록 불러오는 중';
  try {
    const { data, error } = await supabaseClient.from('meallog_data').select('records, alcohol_logs').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    if (data) {
      records = data.records || {};
      alcoholLogs = data.alcohol_logs || {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      localStorage.setItem(ALCOHOL_KEY, JSON.stringify(alcoholLogs));
    } else {
      // 첫 로그인: 기존 브라우저에 남아 있는 기록을 새 클라우드 계정으로 옮깁니다.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      localStorage.setItem(ALCOHOL_KEY, JSON.stringify(alcoholLogs));
      shouldSeedCloud = true;
    }
    renderAll();
    setAccountSignedIn(user);
  } catch (error) {
    console.error('MealLog cloud load failed', error);
    cloudUserId = null;
    $('#auth-message').textContent = '저장소 연결에 실패했어요. Supabase 테이블과 보안 정책을 확인해주세요.';
    $('#account-status').textContent = '연결 실패';
    $('#account-message').textContent = '테이블과 보안 정책 설정을 확인해 주세요. 현재 기록은 이 기기에 보관돼 있어요.';
  } finally {
    loadingCloud = false;
    if (shouldSeedCloud) syncCloud();
  }
}
function initializeCloudAuth() {
  if (!supabaseClient) {
    $('#account-form').classList.add('hidden');
    $('#account-status').textContent = '설정 필요';
    $('#auth-gate').classList.add('hidden');
    $('#app-shell').classList.remove('hidden');
    return;
  }
  supabaseClient.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    if (data.session?.user) loadCloudData(data.session.user);
  }).catch(error => {
    console.error('MealLog auth initialization failed', error);
    $('#account-status').textContent = '연결 실패';
  });
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user) loadCloudData(session.user);
    if (event === 'SIGNED_OUT') { cloudUserId = null; setAccountSignedIn(null); }
  });
}
function toISO(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function fromISO(value) { const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day); }
function dateLabel(value, full = false) { return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: full ? 'long' : undefined }).format(fromISO(value)); }
function mealsFor(value) { const day = fromISO(value).getDay(); return day === 0 || day === 6 ? ['breakfast', 'lunch', 'dinner'] : ['breakfast', 'dinner']; }
function escapeHTML(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function recordKey(date, meal) { return `${date}_${meal}`; }
function dishRows(record) { return (record?.dishes || []).map(dish => normalizeDish(dish, record?.prep)).filter(dish => dish.name); }

function renderAll() { renderToday(); renderCalendar(); renderSummary(); }
function renderToday() {
  $('#today-date-label').textContent = selectedDate === toISO(new Date()) ? '오늘도 잘 챙겨 먹어요' : '지난 식사 기록';
  $('#selected-date').textContent = dateLabel(selectedDate, true);
  $('#meal-list').innerHTML = mealsFor(selectedDate).map(meal => mealCard(selectedDate, meal)).join('');
}
function mealCard(date, meal) {
  const record = records[recordKey(date, meal)];
  const name = MEAL_NAMES[meal];
  if (!record) return `<article class="meal-card"><div class="meal-card-top"><div><div class="meal-name">${name}</div><div class="meal-time">식사 기록</div></div><span class="meal-status empty">기록 전</span></div><button class="meal-add" data-edit="${date}|${meal}"><strong>＋ ${name} 기록하기</strong>어떻게 먹었는지 간단히 남겨보세요</button>${meal === 'dinner' ? alcoholMealSummary(date) : ''}</article>`;
  const dishes = dishRows(record);
  let content = '';
  if (record.mode === '집에서 먹음') {
    content = dishes.length ? dishes.map(dish => `<div class="dish-summary-line"><strong>${escapeHTML(dish.name)}</strong><span>${escapeHTML(dish.prep)}${dish.preparedBy ? ` · ${escapeHTML(dish.preparedBy)}` : ''}</span></div>`).join('') : '<strong>메뉴 미입력</strong>';
  } else if (record.mode === '먹지 않음') content = '';
  else if (record.mode === '외식') content = `<div class="dish-summary-line"><strong>${escapeHTML(record.outsideMenu || '메뉴 미입력')}</strong></div><span>장소 · ${escapeHTML(record.place || '미입력')}</span>`;
  else content = escapeHTML(record.mode);
  const cleanup = record.mode === '집에서 먹음' && record.dishwasher ? `<div class="calendar-extra">설거지 · ${escapeHTML(record.dishwasher)}</div>` : '';
  return `<article class="meal-card"><div class="meal-card-top"><div><div class="meal-name">${name}</div><div class="meal-time">${escapeHTML(record.mode)}</div></div><span class="meal-status">기록 완료</span></div>${content ? `<div class="meal-content">${content}</div>` : ''}${memberMealSummary(record)}${meal === 'dinner' ? alcoholMealSummary(date) : ''}${cleanup}${record.note ? `<div class="meal-note">${escapeHTML(record.note)}</div>` : ''}<button class="meal-edit" data-edit="${date}|${meal}">기록 수정 ›</button></article>`;
}
function alcoholMealSummary(date) {
  const log = alcoholLogs[date];
  if (!log) return '';
  if (!log.didDrink) return '<div class="meal-note">술 · 마시지 않았어요</div>';
  const items = (log.drinks || []).map(drink => `${drink.type} ${drink.amount}${drink.unit}`).join(', ');
  return `<div class="meal-note">술 · ${escapeHTML(items || '마셨어요')} · ${escapeHTML((log.drinkers || []).join('·'))}</div>`;
}
function memberMealSummary(record) {
  if (!record.memberDetails) return '';
  const participants = record.participants || inferParticipants(record, record.mode);
  const ateWithSharedMeal = { '아내': ['both', 'wife'].includes(participants), '남편': ['both', 'husband'].includes(participants) };
  const rows = ['아내', '남편'].filter(person => !ateWithSharedMeal[person]).map(person => {
    const detail = record.memberDetails[person];
    if (!detail) return '';
    const value = detail.ate ? (detail.food || '따로 먹음') : '먹지 않음';
    return `<div><strong>${person}</strong><span>${escapeHTML(value)}</span></div>`;
  }).join('');
  return rows ? `<div class="member-meal-summary">${rows}</div>` : '';
}

function calendarSummary(date) {
  const trackedMeals = mealsFor(date);
  const meals = CALENDAR_MEALS.filter(meal => trackedMeals.includes(meal));
  return `<span class="calendar-pips" aria-hidden="true">${meals.map(meal => {
    const record = records[recordKey(date, meal)];
    let state = 'other'; // 기록 없음/거름
    if (record?.mode === '집에서 먹음') state = 'cooked';
    else if (record?.mode === '외식') state = 'outside';
    return `<span class="calendar-pip ${state}">${CALENDAR_LETTERS[meal]}</span>`;
  }).join('')}</span>`;
}
function renderCalendar() {
  const year = calendarMonth.getFullYear(), month = calendarMonth.getMonth();
  $('#month-label').textContent = `${year}년 ${month + 1}월`;
  const first = new Date(year, month, 1), offset = (first.getDay() + 6) % 7, start = new Date(year, month, 1 - offset);
  let html = '';
  for (let index = 0; index < 42; index++) {
    const date = new Date(start); date.setDate(start.getDate() + index);
    const iso = toISO(date), outside = date.getMonth() !== month;
    const hasRecord = mealsFor(iso).some(meal => records[recordKey(iso, meal)]);
    html += `<button class="calendar-day ${outside ? 'outside' : ''} ${iso === calendarDate ? 'selected' : ''} ${iso === toISO(new Date()) ? 'today' : ''} ${hasRecord ? 'has-record' : ''}" data-date="${iso}" aria-label="${dateLabel(iso, true)}${hasRecord ? ', 기록 있음' : ''}"><span class="calendar-number">${date.getDate()}</span>${calendarSummary(iso)}</button>`;
  }
  $('#calendar-days').innerHTML = html;
  $('#calendar-detail-panel').classList.toggle('hidden', !calendarDateOpened);
  if (!calendarDateOpened) return;
  $('#calendar-detail-title').textContent = dateLabel(calendarDate, true);
  $('#calendar-detail-subtitle').textContent = calendarDate === toISO(new Date()) ? '오늘' : '선택한 날짜';
  const loggedMeals = mealsFor(calendarDate).filter(meal => records[recordKey(calendarDate, meal)]);
  $('#calendar-detail').innerHTML = `${loggedMeals.length ? loggedMeals.map(meal => calendarMealDetail(calendarDate, meal)).join('') : '<p class="empty-state">이 날짜에는 식사 기록이 없어요.</p>'}${alcoholMealSummary(calendarDate)}`;
}
function calendarMealDetail(date, meal) {
  const record = records[recordKey(date, meal)];
  const dishes = dishRows(record);
  let content = '';
  if (record.mode === '집에서 먹음') content = dishes.map(dish => `<div class="dish-summary-line"><strong>${escapeHTML(dish.name)}</strong><span>${escapeHTML(dish.prep)}${dish.preparedBy ? ` · ${escapeHTML(dish.preparedBy)}` : ''}</span></div>`).join('') || '<strong>메뉴 미입력</strong>';
  else if (record.mode === '외식') content = `<div class="dish-summary-line"><strong>${escapeHTML(record.outsideMenu || '메뉴 미입력')}</strong></div><span>장소 · ${escapeHTML(record.place || '미입력')}</span>`;
  else content = '';
  const cleanup = record.mode === '집에서 먹음' && record.dishwasher ? `<div class="calendar-extra">설거지 · ${escapeHTML(record.dishwasher)}</div>` : '';
  return `<article class="meal-card"><div class="meal-card-top"><div><div class="meal-name">${MEAL_NAMES[meal]}</div><div class="meal-time">${escapeHTML(record.mode)}</div></div><span class="meal-status">기록 완료</span></div>${content ? `<div class="meal-content">${content}</div>` : ''}${memberMealSummary(record)}${cleanup}</article>`;
}

function rangeDates() {
  const now = new Date(), end = toISO(now);
  if (summaryRange === 'today') return { start: end, end };
  if (summaryRange === 'week') {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const monday = toISO(weekStart);
    const firstRecordedDate = Object.keys(records).map(key => key.slice(0, 10)).sort()[0];
    const firstTrackedWeek = firstRecordedDate && firstRecordedDate >= monday && firstRecordedDate <= end;
    return { start: firstTrackedWeek ? firstRecordedDate : monday, end };
  }
  if (summaryRange === 'month') {
    const monthStart = toISO(new Date(now.getFullYear(), now.getMonth(), 1));
    const firstRecordedDate = Object.keys(records).map(key => key.slice(0, 10)).filter(date => date >= monthStart && date <= end).sort()[0];
    return { start: firstRecordedDate || monthStart, end };
  }
  return { start: '0000-01-01', end };
}
function countMealSlots(start, end) {
  if (!start || !end || start > end) return 0;
  let count = 0;
  const cursor = fromISO(start), last = fromISO(end);
  while (cursor <= last) {
    count += mealsFor(toISO(cursor)).length;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}
function renderSummary() {
  const { start, end } = rangeDates();
  const entries = Object.entries(records).filter(([key]) => key.slice(0, 10) >= start && key.slice(0, 10) <= end)
    .map(([key, value]) => ({ date: key.slice(0, 10), meal: key.slice(11), ...value }));
  const home = entries.filter(entry => entry.mode === '집에서 먹음');
  const out = entries.filter(entry => entry.mode === '외식');
  const allDishes = home.flatMap(entry => dishRows(entry));
  const isRamen = dish => /라면/i.test(dish.name);
  const dishesForMealPrepCount = entry => {
    const dishes = dishRows(entry);
    const hasOtherMenu = dishRows(entry).some(dish => !isRamen(dish));
    return dishes.filter(dish => !isRamen(dish) || !hasOtherMenu);
  };
  const userPreparedMeals = home.filter(entry => {
    const dishes = dishesForMealPrepCount(entry);
    return dishes.length > 0 && dishes.every(dish => dish.preparedBy === '아내');
  }).length;
  const husbandPreparedMeals = home.filter(entry => {
    const dishes = dishesForMealPrepCount(entry);
    return dishes.length > 0 && dishes.every(dish => dish.preparedBy === '남편');
  }).length;
  const sharedPreparedMeals = home.filter(entry => {
    const people = new Set(dishesForMealPrepCount(entry).map(dish => dish.preparedBy));
    return people.has('함께') || (people.has('아내') && people.has('남편'));
  }).length;
  const countPrep = prep => allDishes.filter(dish => dish.prep === prep).length;
  const deliveryCount = countPrep('배달·포장');
  const firstRecordedDate = entries.length ? entries.map(entry => entry.date).sort()[0] : null;
  const periodStart = summaryRange === 'all' ? firstRecordedDate : start;
  const totalMealSlots = countMealSlots(periodStart, end);
  $('#summary-period').textContent = summaryRange === 'all' ? (entries.length ? `${dateLabel(firstRecordedDate)}부터 오늘까지` : '아직 기록이 없어요') : summaryRange === 'today' ? dateLabel(start, true) : `${dateLabel(start)} — ${dateLabel(end)}`;
  $('#summary-cards').innerHTML = `<div class="summary-stat-group shared-group"><div class="stat-card featured"><div class="stat-label">함께 준비한 끼니</div><div class="stat-value">${sharedPreparedMeals}<small>끼</small></div></div></div><div class="summary-stat-group participation-group"><div class="stat-card"><div class="stat-label">아내가 준비한 끼니</div><div class="stat-value">${userPreparedMeals}<small> / ${totalMealSlots}끼</small></div></div><div class="stat-card"><div class="stat-label">남편이 준비한 끼니</div><div class="stat-value">${husbandPreparedMeals}<small> / ${totalMealSlots}끼</small></div></div></div><div class="summary-stat-group method-group"><div class="stat-card"><div class="stat-label">직접 조리</div><div class="stat-value">${countPrep('직접 조리')}<small>개</small></div></div><div class="stat-card"><div class="stat-label">배달·포장</div><div class="stat-value">${deliveryCount}<small>개</small></div></div><div class="stat-card"><div class="stat-label">외식</div><div class="stat-value">${out.length}<small>끼</small></div></div></div>`;
  const cleanupCounts = {};
  entries.filter(entry => entry.mode === '집에서 먹음' && entry.dishwasher).forEach(entry => { cleanupCounts[entry.dishwasher] = (cleanupCounts[entry.dishwasher] || 0) + 1; });
  $('#dishwashing-summary').innerHTML = rankHTML(cleanupCounts, '설거지 담당 기록이 아직 없어요');
  const dishCounts = {};
  allDishes.filter(dish => !['밀키트·냉동식품', '남은 음식'].includes(dish.prep)).forEach(dish => { dishCounts[dish.name] = (dishCounts[dish.name] || 0) + 1; });
  $('#dish-summary').innerHTML = rankHTML(dishCounts, '기록한 메뉴가 아직 없어요');
  const dates = [...new Set(entries.map(entry => entry.date))].sort().reverse().slice(0, 8);
  const mealOrder = { breakfast: 0, lunch: 1, dinner: 2 };
  const recentMealText = entry => {
    const dishes = dishRows(entry);
    return entry.mode === '집에서 먹음' ? dishes.map(dish => dish.name).join(', ') || '집에서 먹음' : entry.mode === '외식' ? `외식 ${entry.place || ''} ${entry.outsideMenu || ''}` : entry.mode;
  };
  $('#recent-days').innerHTML = dates.length ? dates.map(date => {
    const dayEntries = entries.filter(entry => entry.date === date).sort((a, b) => (mealOrder[a.meal] ?? 9) - (mealOrder[b.meal] ?? 9));
    return `<div class="recent-day-group"><div class="recent-date">${dateLabel(date, true)}</div>${dayEntries.map(entry => `<div class="recent-meal-row"><strong>${MEAL_NAMES[entry.meal] || '식사'}</strong><span>${escapeHTML(recentMealText(entry))}</span></div>`).join('')}</div>`;
  }).join('') : '<p class="empty-state">기록이 쌓이면 날짜별로 보여드릴게요.</p>';
  renderAlcoholSummary(start, end);
  $('#summary-meals-pane').classList.toggle('active', summaryTab === 'meals');
  $('#summary-alcohol-pane').classList.toggle('active', summaryTab === 'alcohol');
  $$('.summary-view-tab').forEach(button => button.classList.toggle('active', button.dataset.summaryTab === summaryTab));
}
function renderAlcoholSummary(start, end) {
  const entries = Object.entries(alcoholLogs).filter(([date, log]) => date >= start && date <= end && log.didDrink).sort(([a], [b]) => b.localeCompare(a));
  const wifeDays = entries.filter(([, log]) => log.drinkers?.includes('아내')).length;
  const husbandDays = entries.filter(([, log]) => log.drinkers?.includes('남편')).length;
  $('#alcohol-summary-cards').innerHTML = `<div class="stat-card featured"><div class="stat-label">술 마신 날</div><div class="stat-value">${entries.length}<small>일</small></div></div><div class="stat-card"><div class="stat-label">아내가 마신 날</div><div class="stat-value">${wifeDays}<small>일</small></div></div><div class="stat-card"><div class="stat-label">남편이 마신 날</div><div class="stat-value">${husbandDays}<small>일</small></div></div>`;
  const totals = {};
  entries.forEach(([, log]) => (log.drinks || []).forEach(drink => {
    const key = `${drink.type}|||${drink.unit}`;
    totals[key] = (totals[key] || 0) + Number(drink.amount || 0);
  }));
  const totalRows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  $('#alcohol-quantity-summary').innerHTML = totalRows.length ? `<div class="rank-list">${totalRows.map(([key, amount]) => { const [type, unit] = key.split('|||'); return `<div class="alcohol-total-row"><span>${escapeHTML(type)}</span><strong>${Number(amount.toFixed(2))} ${escapeHTML(unit)}</strong></div>`; }).join('')}</div>` : '<p class="empty-state">이 기간에는 술 기록이 없어요.</p>';
  $('#alcohol-daily-summary').innerHTML = entries.length ? entries.map(([date, log]) => `<div class="recent-row"><span>${dateLabel(date, true)}</span><span>${escapeHTML((log.drinks || []).map(drink => `${drink.type} ${drink.amount}${drink.unit}`).join(', '))}<small class="alcohol-drinkers"> · ${(log.drinkers || []).map(escapeHTML).join('·')}</small></span></div>`).join('') : '<p class="empty-state">이 기간에는 술 기록이 없어요.</p>';
}
function rankHTML(counts, empty) {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!rows.length) return `<p class="empty-state">${empty}</p>`;
  const max = rows[0][1];
  return `<div class="rank-list">${rows.map(([name, count]) => `<div class="rank-row"><span class="rank-label">${escapeHTML(name)}</span><strong>${count}회</strong><div class="rank-bar"><span style="width:${Math.max(7, count / max * 100)}%"></span></div></div>`).join('')}</div>`;
}

function openEditor(date, meal) {
  const old = records[recordKey(date, meal)];
  $('#form-date').value = date; $('#form-meal').value = meal;
  $('#dialog-date').textContent = dateLabel(date, true); $('#dialog-title').textContent = `${MEAL_NAMES[meal]} 기록`;
  $('#meal-note').value = old?.note || '';
  $('#outside-place').value = old?.place || '';
  $('#outside-menu').value = old?.outsideMenu || '';
  $('#mode-choices').innerHTML = MODES.map((mode, index) => `<label class="choice-chip"><input type="radio" name="mode" value="${mode}" ${old?.mode === mode || (!old && index === 0) ? 'checked' : ''}><span>${mode}</span></label>`).join('');
  renderPersonalMeals(old, old?.mode || MODES[0]);
  $('#cleanup-choices').innerHTML = CLEANUP_OPTIONS.map((person, index) => `<label class="choice-chip"><input type="radio" name="dishwasher" value="${person}" ${old?.dishwasher === person || (!old?.dishwasher && index === 3) ? 'checked' : ''}><span>${person}</span></label>`).join('');
  renderAlcohol(date);
  $('#alcohol-field').classList.toggle('hidden', meal !== 'dinner');
  $('#dish-list').innerHTML = '';
  if (old?.dishes?.length) old.dishes.forEach(dish => addDishField(normalizeDish(dish, old.prep)));
  else addDishField();
  const weekday = fromISO(date).getDay();
  const isWeekdayBreakfast = meal === 'breakfast' && weekday >= 1 && weekday <= 5;
  $('#quick-breakfast').classList.toggle('hidden', !isWeekdayBreakfast);
  $('#delete-meal').classList.toggle('hidden', !old);
  updateConditional(); $('#meal-dialog').showModal();
}
function addDishField(value = {}) {
  const dish = typeof value === 'string' ? { name: value, prep: '직접 조리', preparedBy: '아내' } : { preparedBy: '아내', ...value };
  const row = document.createElement('div'); row.className = 'dish-entry';
  const legacyTogether = dish.preparedBy === '함께';
  const preparerOptions = `${PREPARERS.map(person => `<option value="${person}" ${dish.preparedBy === person ? 'selected' : ''}>${person}</option>`).join('')}<option value="함께" ${legacyTogether ? 'selected' : ''}>함께</option>`;
  row.innerHTML = `<div class="dish-main"><input type="text" maxlength="50" placeholder="예: 된장찌개" value="${escapeHTML(dish.name || '')}" aria-label="메뉴 이름"><button type="button" class="dish-remove" aria-label="메뉴 삭제">×</button></div><div class="dish-options"><select data-prep aria-label="${escapeHTML(dish.name || '이 메뉴')} 준비 방식">${PREP_METHODS.map(method => `<option value="${method}" ${dish.prep === method ? 'selected' : ''}>${method}</option>`).join('')}</select><select data-preparer aria-label="${escapeHTML(dish.name || '이 메뉴')} 준비한 사람">${preparerOptions}</select></div>`;
  row.querySelector('button').onclick = () => { if ($('#dish-list').children.length > 1) row.remove(); else row.querySelector('input').value = ''; };
  row.querySelector('[data-prep]').onchange = () => updateDishAttribution(row);
  updateDishAttribution(row);
  $('#dish-list').append(row);
}
function updateDishAttribution(row) {
  const prep = row.querySelector('[data-prep]').value;
  const personSelect = row.querySelector('[data-preparer]');
  const personIsRelevant = !['남은 음식', '배달·포장'].includes(prep);
  personSelect.classList.toggle('hidden', !personIsRelevant);
  personSelect.disabled = !personIsRelevant;
  if (personIsRelevant && !PREPARERS.includes(personSelect.value) && personSelect.value !== '함께') personSelect.value = '아내';
}
function updateConditional() {
  const mode = $('input[name="mode"]:checked')?.value;
  $('#home-fields').classList.toggle('hidden', mode !== '집에서 먹음');
  $('#cleanup-field').classList.toggle('hidden', mode !== '집에서 먹음');
  $('#outside-fields').classList.toggle('hidden', mode !== '외식');
  $('#note-field').classList.toggle('hidden', mode === '외식');
  const personalField = $('#personal-meal-field');
  if (personalField.dataset.edited !== 'true') {
    const defaultParticipants = mode === '먹지 않음' ? 'neither' : 'both';
    const radio = $(`input[name="meal-participants"][value="${defaultParticipants}"]`);
    if (radio) radio.checked = true;
    renderIndividualMealDetails();
  }
}
function renderPersonalMeals(record, mode) {
  const people = ['아내', '남편'];
  $('#personal-meal-field').dataset.edited = record?.memberDetails ? 'true' : 'false';
  $('#meal-participation-choices').innerHTML = [['both', '둘 다'], ['husband', '남편만'], ['wife', '아내만'], ['neither', '둘 다 안 먹음']].map(([value, label]) => `<label class="choice-chip"><input type="radio" name="meal-participants" value="${value}"><span>${label}</span></label>`).join('');
  draftMemberDetails = {};
  people.forEach(person => {
    const detail = record?.memberDetails?.[person] || {};
    draftMemberDetails[person] = { ate: detail.ate ?? false, food: detail.food || '' };
  });
  const participation = record?.participants || inferParticipants(record, mode);
  const radio = $(`input[name="meal-participants"][value="${participation}"]`);
  if (radio) radio.checked = true;
  $('#meal-participation-choices').onchange = event => {
    $('#personal-meal-field').dataset.edited = 'true';
    renderIndividualMealDetails();
  };
  renderIndividualMealDetails();
}
function inferParticipants(record, mode) {
  if (!record?.memberDetails) return mode === '먹지 않음' ? 'neither' : 'both';
  const wife = Boolean(record.memberDetails['아내']?.ate), husband = Boolean(record.memberDetails['남편']?.ate);
  return wife && husband ? 'both' : wife ? 'wife' : husband ? 'husband' : 'neither';
}
function renderIndividualMealDetails() {
  const participation = $('input[name="meal-participants"]:checked')?.value || 'both';
  const absent = participation === 'both' ? [] : participation === 'wife' ? ['남편'] : participation === 'husband' ? ['아내'] : ['아내', '남편'];
  $('#personal-meal-details').innerHTML = absent.map(person => {
    const detail = draftMemberDetails[person] || { ate: false, food: '' };
    return `<div class="person-meal-card"><strong>${person} 식사</strong><div class="choice-grid"><label class="choice-chip"><input type="radio" name="ate-${person}" value="true" ${detail.ate ? 'checked' : ''}><span>따로 먹었어요</span></label><label class="choice-chip"><input type="radio" name="ate-${person}" value="false" ${!detail.ate ? 'checked' : ''}><span>먹지 않았어요</span></label></div><div class="person-ate-fields ${detail.ate ? '' : 'hidden'}"><label>따로 먹은 음식</label><input type="text" name="food-${person}" maxlength="100" placeholder="예: 김밥, 회식 메뉴" value="${escapeHTML(detail.food)}"></div></div>`;
  }).join('');
  $('#personal-meal-details').oninput = event => {
    $('#personal-meal-field').dataset.edited = 'true';
    const person = event.target.name?.replace(/^food-/, '');
    if (person && draftMemberDetails[person]) draftMemberDetails[person].food = event.target.value;
  };
  $('#personal-meal-details').onchange = event => {
    $('#personal-meal-field').dataset.edited = 'true';
    const person = event.target.name?.replace(/^(ate|food)-/, '');
    if (person && draftMemberDetails[person]) {
      if (event.target.name.startsWith('ate-')) draftMemberDetails[person].ate = event.target.value === 'true';
      else if (event.target.name.startsWith('food-')) draftMemberDetails[person].food = event.target.value;
    }
    if (event.target.name?.startsWith('ate-')) renderIndividualMealDetails();
  };
}
function setView(view) {
  $$('.view').forEach(section => section.classList.toggle('active', section.id === `${view}-view`));
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'calendar') renderCalendar(); if (view === 'summary') renderSummary();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function toast(message) { const element = document.createElement('div'); element.className = 'toast'; element.textContent = message; document.body.append(element); setTimeout(() => element.remove(), 2100); }

$('#prev-day').onclick = () => { const date = fromISO(selectedDate); date.setDate(date.getDate() - 1); selectedDate = toISO(date); renderToday(); };
$('#next-day').onclick = () => { const date = fromISO(selectedDate); date.setDate(date.getDate() + 1); selectedDate = toISO(date); renderToday(); };
$('#go-today').onclick = () => { selectedDate = toISO(new Date()); renderToday(); };
$('#date-picker-button').onclick = () => { $('#date-picker').value = selectedDate; $('#date-picker').showPicker?.(); if (!$('#date-picker').showPicker) $('#date-picker').click(); };
$('#date-picker').onchange = event => { if (event.target.value) { selectedDate = event.target.value; renderToday(); } };
$('#meal-list').addEventListener('click', event => { const button = event.target.closest('[data-edit]'); if (button) { const [date, meal] = button.dataset.edit.split('|'); openEditor(date, meal); } });
$('#calendar-days').addEventListener('click', event => { const button = event.target.closest('[data-date]'); if (button) { calendarDate = button.dataset.date; selectedDate = calendarDate; calendarDateOpened = true; renderCalendar(); } });
$('#prev-month').onclick = () => { calendarMonth.setMonth(calendarMonth.getMonth() - 1); calendarDateOpened = false; renderCalendar(); };
$('#next-month').onclick = () => { calendarMonth.setMonth(calendarMonth.getMonth() + 1); calendarDateOpened = false; renderCalendar(); };
$$('.nav-item').forEach(button => button.onclick = () => setView(button.dataset.view));
$$('.range-tab').forEach(button => button.onclick = () => { $$('.range-tab').forEach(tab => tab.classList.toggle('active', tab === button)); summaryRange = button.dataset.range; renderSummary(); });
$$('.summary-view-tab').forEach(button => button.onclick = () => { summaryTab = button.dataset.summaryTab; renderSummary(); });
$('#mode-choices').onchange = updateConditional;
$('#add-dish').onclick = () => addDishField();
$('#quick-breakfast').addEventListener('click', event => { const button = event.target.closest('[data-quick-dish]'); if (button) addDishField({ name: button.dataset.quickDish, prep: '직접 조리' }); });
$('#close-dialog').onclick = () => $('#meal-dialog').close();
$('#meal-dialog').addEventListener('click', event => { if (event.target === $('#meal-dialog')) $('#meal-dialog').close(); });
$('#meal-form').addEventListener('submit', event => {
  event.preventDefault();
  const date = $('#form-date').value, meal = $('#form-meal').value, mode = $('input[name="mode"]:checked')?.value;
  if (!mode) { toast('먹은 방식을 선택해주세요.'); return; }
  const dishes = $$('#dish-list .dish-entry').map(row => ({ name: row.querySelector('input').value.trim(), prep: row.querySelector('select').value })).filter(dish => dish.name);
  if (mode === '집에서 먹음' && !dishes.length) { toast('메뉴 이름을 하나 이상 적어주세요.'); return; }
  const menuRecords = $$('#dish-list .dish-entry').map(row => {
    const prep = row.querySelector('[data-prep]').value;
    const preparedBy = ['남은 음식', '배달·포장'].includes(prep) ? '' : row.querySelector('[data-preparer]').value;
    return { name: row.querySelector('input').value.trim(), prep, preparedBy };
  }).filter(dish => dish.name);
  const place = $('#outside-place').value.trim(), outsideMenu = $('#outside-menu').value.trim();
  if (mode === '외식' && (!place || !outsideMenu)) { toast('외식 장소와 먹은 메뉴를 입력해주세요.'); return; }
  const participants = $('input[name="meal-participants"]:checked')?.value || 'both';
  const participantAte = { '아내': ['both', 'wife'].includes(participants), '남편': ['both', 'husband'].includes(participants) };
  const memberDetails = {};
  for (const person of ['아내', '남편']) {
    if (participantAte[person]) {
      memberDetails[person] = { ate: true, food: '' };
      continue;
    }
    const ate = $(`input[name="ate-${person}"]:checked`)?.value === 'true';
    const food = $(`[name="food-${person}"]`)?.value.trim() || '';
    if (ate && !food) { toast(`${person}가 따로 먹은 음식을 적어주세요.`); return; }
    memberDetails[person] = { ate, food: ate ? food : '' };
  }
  const alcoholChoice = meal === 'dinner' ? $('input[name="alcohol-status"]:checked')?.value : undefined;
  if (alcoholChoice === 'true') {
    const drinks = $$('#alcohol-drink-list .alcohol-drink-row').map(row => ({ type: row.querySelector('input[type="text"]').value.trim(), amount: row.querySelector('input[type="number"]').value, unit: row.querySelector('select').value })).filter(drink => drink.type && drink.amount);
    const drinkers = $$('input[name="alcohol-drinker"]:checked').map(input => input.value);
    if (!drinks.length) { toast('술 종류와 양을 입력해주세요.'); return; }
    if (!drinkers.length) { toast('마신 사람을 선택해주세요.'); return; }
    alcoholLogs[date] = { didDrink: true, drinks, drinkers };
    persistAlcoholLogs();
  } else if (alcoholChoice === 'false') {
    alcoholLogs[date] = { didDrink: false };
    persistAlcoholLogs();
  }
  const dishwasher = mode === '집에서 먹음' ? $('input[name="dishwasher"]:checked')?.value || '아직 안 함' : '';
  records[recordKey(date, meal)] = { mode, participants, dishes: mode === '집에서 먹음' ? menuRecords : [], place: mode === '외식' ? place : '', outsideMenu: mode === '외식' ? outsideMenu : '', memberDetails, dishwasher, note: mode === '외식' ? '' : $('#meal-note').value.trim(), updatedAt: new Date().toISOString() };
  persist(); $('#meal-dialog').close(); toast('식사 기록을 저장했어요.');
});
$('#delete-meal').onclick = () => { delete records[recordKey($('#form-date').value, $('#form-meal').value)]; persist(); $('#meal-dialog').close(); toast('기록을 삭제했어요.'); };
$('#export-button').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'MealLog', exportedAt: new Date().toISOString(), records, alcoholLogs }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `MealLog-${toISO(new Date())}.json`; link.click(); URL.revokeObjectURL(link.href); toast('기록 파일을 내려받았어요.');
};
$('#import-button').onclick = () => $('#import-file').click();
$('#import-file').onchange = async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup.app !== 'MealLog' || !backup.records || typeof backup.records !== 'object') throw new Error('MealLog 백업 파일이 아닙니다.');
    records = { ...records, ...backup.records };
    alcoholLogs = { ...alcoholLogs, ...(backup.alcoholLogs || {}) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    localStorage.setItem(ALCOHOL_KEY, JSON.stringify(alcoholLogs));
    renderAll();
    syncCloud();
    toast('백업 기록을 가져왔어요.');
  } catch (error) { toast(error.message || '백업 파일을 읽지 못했어요.'); }
  event.target.value = '';
};

function addAlcoholDrink(value = {}) {
  const row = document.createElement('div'); row.className = 'alcohol-drink-row';
  row.innerHTML = `<input type="text" maxlength="40" placeholder="예: 맥주" aria-label="술 종류" value="${escapeHTML(value.type || '')}"><input type="number" min="0.5" step="0.5" inputmode="decimal" placeholder="양" aria-label="마신 양" value="${escapeHTML(value.amount ?? '')}"><select aria-label="단위"><option ${value.unit === '잔' ? 'selected' : ''}>잔</option><option ${value.unit === '병' ? 'selected' : ''}>병</option><option ${value.unit === '캔' ? 'selected' : ''}>캔</option><option ${value.unit === '컵' ? 'selected' : ''}>컵</option></select><button type="button" class="dish-remove" aria-label="술 삭제">×</button>`;
  row.querySelector('button').onclick = () => { if ($('#alcohol-drink-list').children.length > 1) row.remove(); else { row.querySelectorAll('input').forEach(input => input.value = ''); } };
  $('#alcohol-drink-list').append(row);
}
function renderAlcohol(date) {
  const log = alcoholLogs[date];
  $('#alcohol-status-choices').innerHTML = ['마셨어요', '오늘은 안 마셨어요'].map((label, index) => `<label class="choice-chip"><input type="radio" name="alcohol-status" value="${index === 0}" ${log && Boolean(log.didDrink) === (index === 0) ? 'checked' : ''}><span>${label}</span></label>`).join('');
  $('#alcohol-fields').classList.toggle('hidden', !log?.didDrink);
  $('#alcohol-drink-list').innerHTML = '';
  (log?.drinks?.length ? log.drinks : [{}]).forEach(addAlcoholDrink);
  $('#alcohol-drinker-choices').innerHTML = ['아내', '남편'].map(person => `<label class="choice-chip"><input type="checkbox" name="alcohol-drinker" value="${person}" ${log?.drinkers?.includes(person) ? 'checked' : ''}><span>${person}</span></label>`).join('');
  $('#alcohol-status-choices').onchange = event => { $('#alcohol-fields').classList.toggle('hidden', event.target.value !== 'true'); };
}
$('#add-alcohol-drink').onclick = () => addAlcoholDrink();

async function accountAction(action, inputPrefix = 'account') {
  if (!supabaseClient) { toast('supabase-config.js에 Supabase URL과 Publishable key를 먼저 입력해주세요.'); return; }
  const email = $(`#${inputPrefix}-email`).value.trim(), password = $(`#${inputPrefix}-password`).value;
  if (!email || !password) { $('#auth-message').textContent = '이메일과 비밀번호를 입력해주세요.'; return; }
  $('#auth-message').textContent = '계정을 확인하고 있어요.';
  const result = action === 'sign-in'
    ? await supabaseClient.auth.signInWithPassword({ email, password })
    : await supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (result.error) {
    $('#account-status').textContent = '로그인 필요';
    $('#account-message').textContent = result.error.message;
    $('#auth-message').textContent = result.error.message;
    return;
  }
  if (action === 'sign-up' && !result.data.session) {
    $('#account-status').textContent = '이메일 확인 필요';
    $('#account-message').textContent = 'Supabase에서 보낸 확인 이메일의 링크를 누른 뒤 로그인해주세요.';
    $('#auth-message').textContent = '가입 확인 이메일을 보냈어요. 이메일의 링크를 누른 다음 로그인해주세요.';
    return;
  }
  if (result.data.user) await loadCloudData(result.data.user);
}
$('#account-sign-in').onclick = () => accountAction('sign-in').catch(error => { console.error(error); toast('로그인 중 문제가 생겼어요.'); });
$('#account-sign-up').onclick = () => accountAction('sign-up').catch(error => { console.error(error); toast('계정을 만드는 중 문제가 생겼어요.'); });
$('#auth-sign-in').onclick = () => accountAction('sign-in', 'auth').catch(error => { console.error(error); $('#auth-message').textContent = '로그인 중 문제가 생겼어요. 다시 시도해주세요.'; });
$('#auth-sign-up').onclick = () => accountAction('sign-up', 'auth').catch(error => { console.error(error); $('#auth-message').textContent = '계정을 만드는 중 문제가 생겼어요. 다시 시도해주세요.'; });
$('#account-sign-out').onclick = async () => {
  const { error } = await supabaseClient.auth.signOut();
  if (error) toast('로그아웃하지 못했어요.');
};

renderAll();
initializeCloudAuth();
window.addEventListener('online', syncCloud);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
