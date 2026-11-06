// STEMMate Namibia A4, v5: proactive UX and shared-device safeguards.
// Existing IndexedDB v3 stores and local Node.js server API are preserved.
const activities = [
  { id:'act-water', title:'Water Filtration Challenge', topic:'Science', duration:35,
    materials:['Bottle','Sand','Cloth'], description:'Build a basic filter and observe how layers change water clarity.',
    steps:['Arrange filter materials in a cut bottle.','Pour muddy water through the layers.','Compare water before and after filtering.'],
    safety:'Do not drink filtered water. Ask an adult to prepare the cut bottle.',
    inclusion:'Describe each layer verbally and allow participants to handle safe materials.' },
  { id:'act-bridge', title:'Paper Bridge Engineering', topic:'Engineering', duration:25,
    materials:['Paper','Tape','Coins'], description:'Design a paper bridge and investigate which structure holds more weight.',
    steps:['Support paper between two books.','Add coins one at a time.','Fold the paper and test again.'],
    safety:'Keep small coins away from young children.', inclusion:'Explain shapes aloud and allow teamwork for folding.' },
  { id:'act-shadow', title:'Measure and Compare Shadows', topic:'Mathematics', duration:30,
    materials:['Paper','Pencil','Ruler'], description:'Measure shadows and explore how their length changes over time.',
    steps:['Choose a safe outdoor object.','Measure its shadow.','Repeat later and compare measurements.'],
    safety:'Avoid prolonged sun exposure; never look directly at the sun.', inclusion:'Provide large-print measurements or read numbers aloud.' },
  { id:'act-seeds', title:'Seed Germination Observation', topic:'Biology', duration:20,
    materials:['Seeds','Cloth','Water'], description:'Observe how seeds begin growing using simple household materials.',
    steps:['Place seeds on a damp cloth.','Keep the cloth slightly moist.','Record observations over several days.'],
    safety:'Wash hands after handling seeds; do not eat experiment materials.', inclusion:'Use touch-safe samples and verbal observation descriptions.' }
];

const $ = id => document.getElementById(id);
const DB_NAME = 'stemmate_a4', DB_VERSION = 3;
const SAVED_STORE = 'savedActivities', PLANS_STORE = 'sessionPlans', DRAFT_STORE = 'planDrafts';
const DRAFT_ID = 'current';
let dbPromise;
let savedActivities = [], sessionPlans = [];
let currentView = 'browse', previousView = 'browse', selectedId = null;
let formRevision = 0, savedRevision = 0;
let draftQueue = Promise.resolve();
let syncInProgress = false, privacyBusy = false;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function announce(message) { $('status').textContent = message; }
function isSaved(id) { return savedActivities.some(a => a.id === id); }
function findActivity(id) { return activities.find(a => a.id === id) || savedActivities.find(a => a.id === id); }

function getDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        for (const name of [SAVED_STORE, PLANS_STORE, DRAFT_STORE]) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, {keyPath:'id'});
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => console.warn('Close other STEMMate tabs to unblock database upgrade.');
    });
  }
  return dbPromise;
}
function databaseRequest(storeName, method, key) {
  return getDatabase().then(db => new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName)[method](key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
const readAll = storeName => databaseRequest(storeName, 'getAll');
const readOne = (storeName, key) => databaseRequest(storeName, 'get', key);
function transact(storeName, method, value) {
  return getDatabase().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName)[method](value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  }));
}
const putItem = (store, item) => transact(store, 'put', item);
const deleteItem = (store, key) => transact(store, 'delete', key);
async function clearLocalStores() {
  const db = await getDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([SAVED_STORE, PLANS_STORE, DRAFT_STORE], 'readwrite');
    for (const store of [SAVED_STORE, PLANS_STORE, DRAFT_STORE]) tx.objectStore(store).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Clear aborted'));
  });
}

function activityCard(a, saved=false) {
  return `<article class="card">
    <p class="topic">${escapeHtml(a.topic)} · ${Number(a.duration)} minutes</p>
    <h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(a.description)}</p>
    <p><strong>Materials:</strong> ${a.materials.map(escapeHtml).join(', ')}</p>
    <div class="actions">
      <button type="button" data-action="details" data-id="${a.id}">View details</button>
      ${saved ? `<button type="button" class="secondary" data-action="remove" data-id="${a.id}">Remove saved copy</button>`
        : isSaved(a.id) ? '<span class="tag">Saved on this device</span>'
        : `<button type="button" class="secondary" data-action="save" data-id="${a.id}">Save offline</button>`}
    </div></article>`;
}
function renderBrowse() {
  const q=$('searchInput').value.trim().toLowerCase(), m=$('materialFilter').value;
  const found=activities.filter(a => (!m || a.materials.includes(m)) &&
    (!q || `${a.title} ${a.topic} ${a.description}`.toLowerCase().includes(q)));
  $('resultsCount').textContent = `${found.length} of ${activities.length} activities shown`;
  $('activityList').innerHTML=found.length ? found.map(a=>activityCard(a)).join('')
    : '<p class="empty">No matches. Try clearing the filters.</p>';
}
function renderSaved() {
  $('savedCount').textContent=savedActivities.length;
  $('savedList').innerHTML=savedActivities.length ? savedActivities.map(a=>activityCard(a,true)).join('')
    : '<p class="empty">No activities saved yet.</p>';
}
function renderDetails() {
  const a=findActivity(selectedId);
  if (!a) { showView('browse'); return; }
  $('detailContent').innerHTML=`<article class="detail-card">
    <p class="topic">${escapeHtml(a.topic)} · ${Number(a.duration)} minutes</p>
    <h2 id="detailHeading" tabindex="-1">${escapeHtml(a.title)}</h2>
    <p>${escapeHtml(a.description)}</p><h3>Materials</h3><p>${a.materials.map(escapeHtml).join(', ')}</p>
    <h3>Activity steps</h3><ol>${a.steps.map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ol>
    <h3>Safety notes</h3><p>${escapeHtml(a.safety)}</p><h3>Inclusion suggestions</h3>
    <p>${escapeHtml(a.inclusion)}</p><div class="actions">
    ${isSaved(a.id) ? '<span class="tag">Saved on this device</span>'
      : `<button type="button" data-action="save" data-id="${a.id}">Save offline</button>`}
    <button type="button" data-action="create-plan" data-id="${a.id}">Create session plan</button></div></article>`;
}
function planIsPending(p) { return p.syncStatus !== 'synced'; }
function pendingPlans() { return sessionPlans.filter(planIsPending); }
function renderSyncSummary() {
  const pending=pendingPlans().length;
  const failed=pendingPlans().filter(p=>p.lastSyncError).length;
  const synced=sessionPlans.length-pending;
  $('pendingCount').textContent=pending;
  $('syncAll').disabled=(pending===0 || syncInProgress || privacyBusy);
  const summary=$('syncSummary');
  if (!sessionPlans.length) summary.textContent='No completed plans yet. Save a plan to add it to the local queue.';
  else if (pending) summary.textContent=`${pending} pending plan${pending===1?'':'s'} remain${pending===1?'s':''} saved on this device. ${failed} failed last attempt. ${synced} acknowledged by the receiver. A failed sync does not delete the local plan.`;
  else summary.textContent=`All ${synced} completed plan${synced===1?' is':'s are'} acknowledged by the receiver.`;
}
function renderPlans() {
  $('planCount').textContent=sessionPlans.length;
  renderSyncSummary();
  const ordered=[...sessionPlans].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  $('plansList').innerHTML=ordered.length ? ordered.map(p=>{
    const status=p.syncStatus==='synced' ? 'Synced — receiver acknowledged'
      : p.lastSyncError ? 'Pending — last sync failed; plan remains saved here'
      : 'Pending — saved locally, not yet acknowledged';
    return `<article class="card">
      <p class="topic">${escapeHtml(p.activityTitle)}</p><h3>${escapeHtml(p.title)}</h3>
      <p><strong>Duration:</strong> ${Number(p.duration)} minutes</p>
      <p><strong>Steps:</strong></p><p class="plan-text">${escapeHtml(p.steps)}</p>
      <p><strong>Safety notes:</strong></p><p class="plan-text">${escapeHtml(p.safety)}</p>
      <p><strong>Sync status:</strong> ${status}</p>
      ${p.lastSyncError ? `<p class="muted">Last attempt: ${escapeHtml(p.lastSyncError)}</p>` : ''}
      ${p.syncStatus==='synced'
        ? `<p class="muted">Acknowledged: ${escapeHtml(p.syncedAt||'')}</p>`
        : `<button type="button" data-sync="${escapeHtml(p.id)}" ${syncInProgress?'disabled':''}>${p.lastSyncError?'Retry sync':'Sync now'}</button>`}
    </article>`;
  }).join('') : '<p class="empty">No completed session plans saved yet.</p>';
}
function renderPrivacySummary(draftExists) {
  $('localDataSummary').textContent=`Stored locally: ${savedActivities.length} saved activit${savedActivities.length===1?'y':'ies'}, ${draftExists?1:0} unfinished draft, ${sessionPlans.length} completed plan${sessionPlans.length===1?'':'s'}.`;
}
async function refreshPrivacySummary() { renderPrivacySummary(Boolean(await readOne(DRAFT_STORE, DRAFT_ID))); }
function showView(name) {
  currentView=name;
  for (const section of ['browse','saved','detail','plans','privacy']) $(`${section}View`).hidden=(section!==name);
  for (const tab of ['browse','saved','plans','privacy']) $(`${tab}Tab`).setAttribute('aria-pressed',String(tab===name));
  const headings={browse:'browseHeading',saved:'savedHeading',detail:'detailHeading',plans:'plansHeading',privacy:'privacyHeading'};
  $(headings[name])?.focus();
  if (name==='privacy') void refreshPrivacySummary().catch(console.error);
}
function showDetails(id) {
  previousView=currentView==='saved'?'saved':'browse';
  selectedId=id; renderDetails(); showView('detail');
}
async function refreshSaved() {
  savedActivities=await readAll(SAVED_STORE); renderBrowse(); renderSaved();
  if(currentView==='detail') renderDetails();
}
async function refreshPlans() { sessionPlans=await readAll(PLANS_STORE); renderPlans(); }
async function handleActivityClick(event) {
  if (privacyBusy) return;
  const button=event.target.closest('button[data-action]'); if (!button) return;
  const {action,id}=button.dataset;
  if (action==='details') return showDetails(id);
  if (action==='create-plan') { showView('plans'); $('planActivity').value=id; markChanged(); $('planTitle').focus(); return; }
  try {
    if (action==='save') { const a=findActivity(id); if(!a)return; await putItem(SAVED_STORE,a); announce(`${a.title} saved on this device.`); }
    else if (action==='remove') { await deleteItem(SAVED_STORE,id); announce('Saved activity removed.'); }
    await refreshSaved();
  } catch(e) { console.error(e); announce('Unable to update saved activities.'); }
}

// FR-04: honest and explicit draft status.
function setDraftState(state, heading, detail) {
  $('draftStatus').dataset.state=state;
  $('draftState').textContent=heading;
  $('draftDetail').textContent=detail;
}
function draftSnapshot() {
  return {id:DRAFT_ID,activityId:$('planActivity').value,title:$('planTitle').value,
    duration:$('planDuration').value,steps:$('planSteps').value,safety:$('planSafety').value,
    savedAt:new Date().toISOString()};
}
function hasContent(d) { return ['activityId','title','duration','steps','safety'].some(k=>String(d[k]||'').trim()); }
function markChanged() {
  if (privacyBusy) return;
  formRevision++;
  setDraftState('unsaved','Unsaved changes','Changes are not yet protected. The next auto-save check runs within 30 seconds; or select Save draft now.');
}
function saveDraft(force=false) {
  if (privacyBusy || (!force && formRevision===savedRevision)) return Promise.resolve();
  const revision=formRevision, snapshot=draftSnapshot();
  setDraftState('saving','Saving draft…','Writing the current draft to this browser.');
  const work=draftQueue.then(async()=>{
    if (privacyBusy) return;
    if (hasContent(snapshot)) await putItem(DRAFT_STORE,snapshot);
    else await deleteItem(DRAFT_STORE,DRAFT_ID);
    if (revision===formRevision) {
      savedRevision=revision;
      if (hasContent(snapshot)) setDraftState('saved','Draft saved',`Saved locally at ${new Date(snapshot.savedAt).toLocaleTimeString()}.`);
      else setDraftState('empty','No unfinished draft','Start typing to create a draft.');
    } else setDraftState('unsaved','Newer changes remain unsaved','Another auto-save will capture the latest changes.');
  });
  draftQueue=work.catch(()=>{});
  return work.catch(error=>{ console.error(error); setDraftState('error','Draft save failed','Your changes may not be protected. Check storage and select Save draft now.'); });
}
async function restoreDraft() {
  const d=await readOne(DRAFT_STORE,DRAFT_ID);
  if (!d) { setDraftState('empty','No unfinished draft','Start typing to create a draft.'); return; }
  for(const [id,value] of [['planActivity',d.activityId],['planTitle',d.title],['planDuration',d.duration],['planSteps',d.steps],['planSafety',d.safety]]) $(id).value=value||'';
  setDraftState('saved','Recovered saved draft',`Last saved locally at ${new Date(d.savedAt).toLocaleString()}.`);
  savedRevision=formRevision;
}
async function discardDraft() {
  if (privacyBusy) return;
  if (!confirm('Discard the unfinished draft? This cannot be undone.')) return;
  await draftQueue;
  try {
    await deleteItem(DRAFT_STORE,DRAFT_ID); $('planForm').reset(); formRevision++; savedRevision=formRevision;
    setDraftState('empty','Draft discarded','No unfinished draft remains in this browser.');
  } catch(e) { console.error(e); setDraftState('error','Could not discard draft','Try again.'); }
}
async function savePlanAndClearDraft(plan) {
  const db=await getDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction([PLANS_STORE,DRAFT_STORE],'readwrite');
    tx.objectStore(PLANS_STORE).put(plan); tx.objectStore(DRAFT_STORE).delete(DRAFT_ID);
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error||new Error('Save aborted'));
  });
}
async function saveCompletedPlan(event) {
  event.preventDefault(); if(privacyBusy)return;
  if(!$('planForm').reportValidity())return;
  const activity=findActivity($('planActivity').value);
  const title=$('planTitle').value.trim(),steps=$('planSteps').value.trim(),safety=$('planSafety').value.trim(),duration=Number($('planDuration').value);
  if(!activity||!title||!steps||!safety||!Number.isInteger(duration)||duration<1||duration>480) {
    $('planStatus').textContent='Complete all required fields with valid information.'; return;
  }
  const plan={id:crypto.randomUUID(),activityId:activity.id,activityTitle:activity.title,title,duration,steps,safety,
    createdAt:new Date().toISOString(),syncStatus:'pending',syncAttempts:0,lastSyncError:'',syncedAt:null};
  try {
    await draftQueue; await savePlanAndClearDraft(plan); $('planForm').reset(); formRevision++; savedRevision=formRevision;
    setDraftState('empty','No unfinished draft','The draft was cleared after successful completion.');
    $('planStatus').textContent=`Completed plan "${title}" saved locally and queued for synchronisation.`;
    await refreshPlans(); announce('Completed plan saved and queued locally.');
  } catch(e) {console.error(e); $('planStatus').textContent='Could not save completed plan.';}
}

// FR-06: only a real server acknowledgement changes the status to Synced.
function planPayload(p) { return {id:p.id,activityId:p.activityId,activityTitle:p.activityTitle,title:p.title,duration:p.duration,steps:p.steps,safety:p.safety,createdAt:p.createdAt}; }
async function sendPlans(ids) {
  if(privacyBusy) { $('syncStatus').textContent='Local-data management is in progress.'; return; }
  if(syncInProgress) { $('syncStatus').textContent='Synchronisation is already in progress.'; return; }
  syncInProgress=true; renderPlans(); let success=0,failed=0;
  try {
    for(const id of ids) {
      const p=sessionPlans.find(x=>x.id===id); if(!p||!planIsPending(p))continue;
      $('syncStatus').textContent=`Sending ${p.title}…`;
      const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),7000);
      try {
        const response=await fetch('/api/plans',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(planPayload(p)),signal:controller.signal});
        if(!response.ok)throw new Error(`Receiver returned HTTP ${response.status}`);
        const receipt=await response.json();
        if(receipt.id!==p.id||!receipt.receivedAt)throw new Error('Incomplete receiver receipt');
        await putItem(PLANS_STORE,{...p,syncStatus:'synced',syncedAt:receipt.receivedAt,syncAttempts:(p.syncAttempts||0)+1,lastSyncError:''}); success++;
      } catch(e) {
        const message=e.name==='AbortError'?'Receiver timed out':'Receiver unavailable or rejected request';
        console.warn('Sync failed; local copy retained.',e);
        try {await putItem(PLANS_STORE,{...p,syncStatus:'pending',syncAttempts:(p.syncAttempts||0)+1,lastSyncError:message});}
        catch(storageError){ console.error(storageError); }
        failed++;
      } finally {clearTimeout(timer); await refreshPlans();}
    }
    $('syncStatus').textContent=`Sync finished: ${success} acknowledged; ${failed} unsuccessful. Pending plans remain saved locally. Select Retry sync after service returns.`;
  } finally {syncInProgress=false;renderPlans();}
}
function syncAllPending(){return sendPlans(pendingPlans().map(p=>p.id));}
async function verifyReceipt(){
  try {
    const response=await fetch('/api/received',{cache:'no-store'}); if(!response.ok)throw new Error('Unavailable');
    const data=await response.json();
    $('syncStatus').textContent=`Receiver currently stores ${data.count} plan(s). ${data.plans.map(p=>p.title).join('; ')}`;
  }catch(e){ $('syncStatus').textContent='Receiving server unavailable. Plans stored locally are unaffected.'; }
}

// Shared-device data management: export first, confirmed local-only clearing.
async function exportLocalData() {
  if(privacyBusy)return;
  const button=$('exportLocalButton'); button.disabled=true;
  try {
    // Capture any changes currently visible in the editor before exporting.
    await saveDraft(true);
    await draftQueue;
    const [saved,drafts,plans]=await Promise.all([readAll(SAVED_STORE),readAll(DRAFT_STORE),readAll(PLANS_STORE)]);
    const contents={format:'STEMMate local data export',version:1,exportedAt:new Date().toISOString(),savedActivities:saved,planDrafts:drafts,sessionPlans:plans,
      warning:'This file can contain sensitive facilitator-entered text. Store it securely. Received server plans are NOT included.'};
    const blob=new Blob([JSON.stringify(contents,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const link=document.createElement('a');
    link.href=url;link.download=`stemmate-local-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
    $('privacyStatus').textContent='Local export download requested. Confirm the JSON file is in Downloads before clearing data.';
  }catch(e){console.error(e);$('privacyStatus').textContent='Export failed. Do not clear local data until you have checked your backup.';}
  finally {button.disabled=false;}
}
function updateClearButton(){ $('clearLocalButton').disabled=(privacyBusy||syncInProgress||$('clearConfirmation').value!=='CLEAR'); }
async function clearLocalData() {
  if($('clearConfirmation').value!=='CLEAR'||privacyBusy)return;
  if(syncInProgress){$('privacyStatus').textContent='Finish synchronisation before clearing local data.';return;}
  privacyBusy=true; updateClearButton(); $('exportLocalButton').disabled=true;
  $('privacyStatus').textContent='Clearing the three local data stores…';
  try {
    await draftQueue;
    await clearLocalStores();
    savedActivities=[];sessionPlans=[];selectedId=null;
    $('planForm').reset();formRevision++;savedRevision=formRevision;
    $('clearConfirmation').value='';
    setDraftState('empty','No unfinished draft','Local draft was cleared.');
    renderBrowse();renderSaved();renderPlans();renderPrivacySummary(false);
    $('planStatus').textContent='Local session plans cleared.';
    $('syncStatus').textContent='No local plans remain. The receiver may still retain previously acknowledged records.';
    $('privacyStatus').textContent='Local saved activities, drafts and completed plans were cleared. Server records and cached application files were NOT deleted.';
    announce('This browser’s saved STEMMate data has been cleared.');
  }catch(e){ console.error(e);$('privacyStatus').textContent='Local clearing failed. Data may remain; check storage before handing over the device.'; }
  finally {privacyBusy=false;$('exportLocalButton').disabled=false;updateClearButton();}
}

async function start() {
  for(const m of [...new Set(activities.flatMap(a=>a.materials))].sort()){
    const opt=document.createElement('option');opt.value=m;opt.textContent=m;$('materialFilter').append(opt);
  }
  for(const a of activities){const opt=document.createElement('option');opt.value=a.id;opt.textContent=a.title;$('planActivity').append(opt);}
  $('searchInput').addEventListener('input',renderBrowse);
  $('materialFilter').addEventListener('change',renderBrowse);
  $('clearFilters').addEventListener('click',()=>{$('searchInput').value='';$('materialFilter').value='';renderBrowse();$('searchInput').focus();});
  for(const name of ['browse','saved','plans','privacy']) $(name+'Tab').addEventListener('click',()=>showView(name));
  $('backButton').addEventListener('click',()=>showView(previousView));
  $('planForm').addEventListener('submit',saveCompletedPlan);
  for(const field of $('planForm').querySelectorAll('input,select,textarea')){
    field.addEventListener('input',markChanged);field.addEventListener('change',markChanged);
  }
  $('saveDraftNow').addEventListener('click',()=>void saveDraft(true));
  $('discardDraft').addEventListener('click',()=>void discardDraft());
  $('syncAll').addEventListener('click',()=>void syncAllPending());
  $('verifyReceipt').addEventListener('click',()=>void verifyReceipt());
  $('plansList').addEventListener('click',e=>{const b=e.target.closest('button[data-sync]');if(b)void sendPlans([b.dataset.sync]);});
  for(const id of ['activityList','savedList','detailContent']) $(id).addEventListener('click',handleActivityClick);
  $('exportLocalButton').addEventListener('click',()=>void exportLocalData());
  $('clearConfirmation').addEventListener('input',updateClearButton);
  $('clearLocalButton').addEventListener('click',()=>void clearLocalData());
  renderBrowse();
  try {await refreshSaved();await refreshPlans();await restoreDraft();await refreshPrivacySummary();announce('Ready. Your local activities and plans are available.');}
  catch(e){console.error(e);announce('Some local data could not be loaded. Check browser storage.');setDraftState('error','Storage unavailable','Drafts may not be saved.');}
  setInterval(()=>void saveDraft(),30000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void saveDraft();});
}
start();
if('serviceWorker' in navigator){window.addEventListener('load',()=>{
  navigator.serviceWorker.register('./service-worker.js').then(()=>console.log('STEMMate service worker registered.')).catch(e=>console.error('Service worker registration failed',e));
});}
