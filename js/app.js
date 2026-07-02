import{initFirebase,onAuth,loginGoogle,logoutGoogle,loadData,subscribeData,saveData,stopDataSubscription}from"./firebase.js";import{initCalendar,connectCalendar,isCalendarReady,isCalendarConnected,upsertCalendarEvent,deleteCalendarEvent}from"./calendar.js";
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],MONTHS=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"],DAYS=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const state={user:null,authResolved:false,cloudLoaded:false,editEventId:null,editPersonId:null,nextEventId:null,year:new Date().getFullYear(),month:new Date().getMonth(),data:defaults()};
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}function defaults(){return{theme:"dark",settings:{schedules:[{id:uid(),day:0,time:"10:30",type:"Culto Dominical"},{id:uid(),day:4,time:"20:00",type:"Estudio Bíblico"}]},events:[],people:[{id:uid(),name:"Gabriel Hijo",role:"Predicador",email:""},{id:uid(),name:"Camilo González",role:"Ambos",email:""},{id:uid(),name:"Josué Huaiquio",role:"Predicador",email:""},{id:uid(),name:"Daniel Frías",role:"Coordinador",email:""},{id:uid(),name:"Marcelo Vásquez",role:"Coordinador",email:""},{id:uid(),name:"Gabriel Padre",role:"Coordinador",email:""}],guests:[],series:[{id:uid(),name:"Hebreos",chapters:13,done:0},{id:uid(),name:"2 Pedro",chapters:3,done:0}]}}function pad(n){return String(n).padStart(2,"0")}function today(){const d=new Date;return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}function fmt(ds){const[y,m,d]=ds.split("-");return`${d}/${m}/${y}`}function initials(n){return(n||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}function toast(m){$("#toast").textContent=m;$("#toast").classList.remove("hidden");setTimeout(()=>$("#toast").classList.add("hidden"),2800)}function merge(d,i){return{...d,...i,settings:{...d.settings,...(i.settings||{}),schedules:i.settings?.schedules?.length?i.settings.schedules:d.settings.schedules},people:i.people?.length?i.people:d.people,events:i.events||[],guests:i.guests||[],series:i.series?.length?i.series:d.series}}function loadLocal(){try{const raw=localStorage.getItem("liturgica-final");if(raw)state.data=merge(defaults(),JSON.parse(raw))}catch{}}function saveLocal(){localStorage.setItem("liturgica-final",JSON.stringify(state.data))}async function save(){applyTheme();saveLocal();if(state.user&&state.cloudLoaded)await saveData(state.user.uid,state.data);render()}function applyTheme(){document.documentElement.setAttribute("data-theme",state.data.theme||"dark")}function setView(v){$$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===v));$$('.view').forEach(x=>x.classList.remove('active'));const t=$(`#view-${v}`);if(t)t.classList.add('active');render()}function openModal(id){$('#'+id).classList.remove('hidden')}function closeModal(id){$('#'+id).classList.add('hidden')}
function updateStatus(){sessionPill.textContent=state.authResolved?(state.user?`🟢 ${state.user.email}`:"⚪ Sin sesión"):"🟡 Cargando sesión";dbPill.textContent=state.user?(state.cloudLoaded?"🟢 Firebase sincronizado":"🟡 Cargando datos"):"⚪ Modo local";calendarPill.textContent=isCalendarConnected()?"🟢 Calendar conectado":isCalendarReady()?"🟡 Calendar listo":"⚪ Calendar pendiente";loginBtn.classList.toggle('hidden',!!state.user);logoutBtn.classList.toggle('hidden',!state.user)}
function populateSelects(){const p=state.data.people.filter(x=>x.role==='Predicador'||x.role==='Ambos'),c=state.data.people.filter(x=>x.role==='Coordinador'||x.role==='Ambos');eventPreacher.innerHTML='<option value="">— Seleccionar —</option>'+p.map(x=>`<option>${x.name}</option>`).join('');eventCoordinator.innerHTML='<option value="">— Seleccionar —</option>'+c.map(x=>`<option>${x.name}</option>`).join('');eventGuest.innerHTML='<option value="">— Sin invitado —</option>'+state.data.guests.map(g=>`<option>${g.name}</option>`).join('')}
function openEventModal(isGuest=false,date=null){state.editEventId=null;populateSelects();eventModalTitle.textContent=isGuest?'Nueva reunión con invitado':'Nueva reunión';deleteEvent.classList.add('hidden');eventDate.value=date||today();eventTime.value='10:30';eventType.value=isGuest?'Invitado':'Culto Dominical';eventPreacher.value='';eventCoordinator.value='';eventGuest.value='';eventPassage.value='';eventTitleInput.value='';eventNotes.value='';openModal('eventModal')}function editEventModal(ev){if(!ev)return;state.editEventId=ev.id;populateSelects();eventModalTitle.textContent='Editar reunión';deleteEvent.classList.remove('hidden');eventDate.value=ev.date||today();eventTime.value=ev.time||'10:30';eventType.value=ev.type||'Culto Dominical';eventPreacher.value=ev.preacher||'';eventCoordinator.value=ev.coordinator||'';eventGuest.value=ev.guest||'';eventPassage.value=ev.passage||'';eventTitleInput.value=ev.title||'';eventNotes.value=ev.notes||'';openModal('eventModal')}
async function saveEventData(){const old=state.editEventId?state.data.events.find(e=>e.id===state.editEventId):null,ev={id:state.editEventId||uid(),date:eventDate.value,time:eventTime.value,type:eventType.value,preacher:eventPreacher.value,coordinator:eventCoordinator.value,guest:eventGuest.value,passage:eventPassage.value.trim(),title:eventTitleInput.value.trim(),notes:eventNotes.value.trim(),calendarId:old?.calendarId||''};if(!ev.date){toast('Selecciona una fecha.');return}state.data.events=state.editEventId?state.data.events.map(e=>e.id===state.editEventId?ev:e):[...state.data.events,ev];closeModal('eventModal');await save();toast('Reunión guardada.')}async function removeEventData(){if(!state.editEventId)return;const ev=state.data.events.find(e=>e.id===state.editEventId);if(!confirm('¿Eliminar esta reunión?'))return;if(ev?.calendarId&&isCalendarConnected())try{await deleteCalendarEvent(ev.calendarId)}catch(e){console.warn(e)}state.data.events=state.data.events.filter(e=>e.id!==state.editEventId);state.editEventId=null;closeModal('eventModal');await save();toast('Reunión eliminada.')}async function sendEventToCalendar(id){const ev=state.data.events.find(e=>e.id===id);if(!ev)return;if(!isCalendarConnected()){const ok=await connectCalendar();if(!ok){toast('No se pudo conectar Google Calendar.');return}}try{const cal=await upsertCalendarEvent(ev,state.data.people,state.data.guests);ev.calendarId=cal.id;await save();toast('Evento enviado a Google Calendar.')}catch(e){console.error(e);toast('Error al enviar a Calendar.')}}
async function generateMonth(){const sch=state.data.settings?.schedules||[];if(!sch.length){toast('Configura al menos un horario.');return}const days=new Date(state.year,state.month+1,0).getDate();let added=0;for(let d=1;d<=days;d++){const date=`${state.year}-${pad(state.month+1)}-${pad(d)}`,dow=new Date(state.year,state.month,d).getDay();sch.forEach(s=>{if(Number(s.day)!==dow)return;const exists=state.data.events.some(e=>e.date===date&&e.time===s.time&&e.type===s.type);if(!exists){state.data.events.push({id:uid(),date,time:s.time,type:s.type,preacher:'',coordinator:'',guest:'',passage:'',title:'',notes:'',calendarId:''});added++}})}await save();toast(`${added} reuniones generadas.`)}
function openPersonModal(id=null){
  state.editPersonId=id;
  const p=id?state.data.people.find(x=>x.id===id):null;
  if(p){
    personName.value=p.name||'';
    personRole.value=p.role||'Predicador';
    personEmail.value=p.email||'';
    const title=document.querySelector('#personModal h3');
    if(title) title.textContent='Editar persona';
  }else{
    personName.value='';
    personRole.value='Predicador';
    personEmail.value='';
    const title=document.querySelector('#personModal h3');
    if(title) title.textContent='Agregar persona';
  }
  ensureDeletePersonButton(!!id);
  openModal('personModal');
}

function ensureDeletePersonButton(show){
  const footer=document.querySelector('#personModal footer');
  if(!footer)return;
  let btn=document.getElementById('deletePersonBtn');
  if(!btn){
    btn=document.createElement('button');
    btn.id='deletePersonBtn';
    btn.className='btn danger';
    btn.textContent='Eliminar';
    btn.addEventListener('click',deletePerson);
    footer.prepend(btn);
  }
  btn.classList.toggle('hidden',!show);
}

async function savePerson(){
  const name=personName.value.trim();
  if(!name){toast('Escribe un nombre.');return}
  const personData={id:state.editPersonId||uid(),name,role:personRole.value,email:personEmail.value.trim()};
  if(state.editPersonId){
    const old=state.data.people.find(p=>p.id===state.editPersonId);
    const oldName=old?.name;
    state.data.people=state.data.people.map(p=>p.id===state.editPersonId?personData:p);
    if(oldName&&oldName!==personData.name){
      state.data.events=state.data.events.map(e=>({
        ...e,
        preacher:e.preacher===oldName?personData.name:e.preacher,
        coordinator:e.coordinator===oldName?personData.name:e.coordinator
      }));
    }
    toast('Persona actualizada.');
  }else{
    state.data.people.push(personData);
    toast('Persona agregada.');
  }
  state.editPersonId=null;
  closeModal('personModal');
  await save();
}

async function deletePerson(){
  if(!state.editPersonId)return;
  const p=state.data.people.find(x=>x.id===state.editPersonId);
  if(!p)return;
  const used=state.data.events.some(e=>e.preacher===p.name||e.coordinator===p.name);
  const msg=used
    ? `Esta persona está asignada en reuniones.\n\nSi la eliminas, quedará vacío donde aparecía.\n\n¿Eliminar a ${p.name}?`
    : `¿Eliminar a ${p.name}?`;
  if(!confirm(msg))return;
  state.data.people=state.data.people.filter(x=>x.id!==state.editPersonId);
  state.data.events=state.data.events.map(e=>({
    ...e,
    preacher:e.preacher===p.name?'':e.preacher,
    coordinator:e.coordinator===p.name?'':e.coordinator
  }));
  state.editPersonId=null;
  closeModal('personModal');
  await save();
  toast('Persona eliminada.');
}

async function saveGuest(){const name=guestName.value.trim();if(!name){toast('Escribe el invitado.');return}state.data.guests.push({id:uid(),name,church:guestChurch.value.trim(),email:guestEmail.value.trim(),phone:guestPhone.value.trim(),notes:guestNotes.value.trim()});['guestName','guestChurch','guestEmail','guestPhone','guestNotes'].forEach(id=>$('#'+id).value='');closeModal('guestModal');await save()}async function saveSeries(){const name=seriesName.value.trim();if(!name){toast('Escribe la serie.');return}state.data.series.push({id:uid(),name,chapters:Number(seriesChapters.value||1),done:Number(seriesDone.value||0)});seriesName.value='';seriesChapters.value='1';seriesDone.value='0';closeModal('seriesModal');await save()}
function renderDashboard(){const events=[...state.data.events].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)),future=events.filter(e=>e.date>=today()),next=future[0]||null;state.nextEventId=next?.id||null;const monthly=events.filter(e=>{const[y,m]=e.date.split('-').map(Number);return y===state.year&&m===state.month+1});nextTitle.textContent=next?`${next.type} · ${fmt(next.date)}`:'—';nextInfo.textContent=next?`${next.time||''} · ${next.preacher||'Predicador pendiente'} · ${next.passage||'Pasaje pendiente'}`:'No hay reuniones próximas.';editNextBtn.classList.toggle('hidden',!next);sendNextCalendarBtn.classList.toggle('hidden',!next||!!next.calendarId);monthCount.textContent=monthly.length;pendingCount.textContent=events.filter(e=>!e.preacher||!e.coordinator||!e.passage).length;seriesCount.textContent=state.data.series.length;agendaMonth.textContent=`${MONTHS[state.month]} ${state.year}`;monthlyAgenda.innerHTML=monthly.length?monthly.map(e=>`<div class="agenda-item"><div class="agenda-date">${Number(e.date.split('-')[2])}<small>${e.time||''}</small></div><div class="agenda-main"><strong>${e.type}</strong><small>${e.preacher||'Predicador pendiente'} · ${e.coordinator||'Coordinador pendiente'}</small></div><span class="badge">${e.passage||'Sin pasaje'}</span></div>`).join(''):'<p class="muted">No hay reuniones este mes.</p>';const alerts=[];future.slice(0,8).forEach(e=>{if(!e.preacher)alerts.push({level:'err',text:`Falta predicador: ${fmt(e.date)} ${e.type}`});if(!e.coordinator)alerts.push({level:'warn',text:`Falta coordinador: ${fmt(e.date)} ${e.type}`});if(!e.passage)alerts.push({level:'warn',text:`Falta pasaje: ${fmt(e.date)} ${e.type}`})});if(!alerts.length)alerts.push({level:'ok',text:'Todo listo en las próximas reuniones.'});alertsList.innerHTML=alerts.map(a=>`<div class="alert ${a.level}">${a.text}</div>`).join('')}
function renderCalendar(){calendarTitle.textContent=`${MONTHS[state.month]} ${state.year}`;calendarGrid.innerHTML='';const first=new Date(state.year,state.month,1).getDay(),days=new Date(state.year,state.month+1,0).getDate();for(let i=0;i<first;i++)calendarGrid.insertAdjacentHTML('beforeend','<div class="day empty"></div>');for(let d=1;d<=days;d++){const date=`${state.year}-${pad(state.month+1)}-${pad(d)}`,events=state.data.events.filter(e=>e.date===date),div=document.createElement('div');div.className=`day ${date===today()?'today':''}`;div.innerHTML=`<div class="day-num">${d}</div>`+events.map(e=>`<div class="day-event" title="${e.type}">${e.type}</div>`).join('');div.addEventListener('click',()=>openEventModal(false,date));calendarGrid.appendChild(div)}}function renderEvents(){const rows=[...state.data.events].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));eventsTable.innerHTML=rows.length?rows.map(e=>`<tr><td><strong>${fmt(e.date)}</strong></td><td>${e.time||'—'}</td><td><span class="badge">${e.type}</span></td><td>${e.preacher||'—'}</td><td>${e.coordinator||'—'}</td><td>${e.passage||'—'}</td><td>${e.guest||'—'}</td><td>${e.calendarId?'✅':`<button class="btn ghost" data-calendar="${e.id}">Enviar</button>`}</td><td><button class="action" data-edit="${e.id}">✏️</button></td></tr>`).join(''):'<tr><td colspan="9">Sin reuniones.</td></tr>';$$('[data-edit]').forEach(b=>b.addEventListener('click',()=>editEventModal(state.data.events.find(e=>e.id===b.dataset.edit))));$$('[data-calendar]').forEach(b=>b.addEventListener('click',()=>sendEventToCalendar(b.dataset.calendar)))}function renderPeople(){
  peopleGrid.innerHTML=state.data.people.map(p=>`<article class="info-card editable-card">
    <div class="avatar">${initials(p.name)}</div>
    <h3>${p.name}</h3>
    <p>${p.role}</p>
    <p>${p.email||'Sin correo'}</p>
    <div class="card-actions">
      <button class="btn ghost" data-edit-person="${p.id}">Editar</button>
      <button class="btn danger" data-delete-person="${p.id}">Eliminar</button>
    </div>
  </article>`).join('');
  document.querySelectorAll('[data-edit-person]').forEach(b=>b.addEventListener('click',()=>openPersonModal(b.dataset.editPerson)));
  document.querySelectorAll('[data-delete-person]').forEach(b=>b.addEventListener('click',async()=>{
    state.editPersonId=b.dataset.deletePerson;
    await deletePerson();
  }));
}
function renderGuests(){guestsGrid.innerHTML=state.data.guests.length?state.data.guests.map(g=>`<article class="info-card"><div class="avatar">${initials(g.name)}</div><h3>${g.name}</h3><p>${g.church||'Sin referencia'}</p><p>${g.email||'Sin correo'}</p></article>`).join(''):'<p class="muted">Aún no hay invitados guardados.</p>'}function renderSeries(){seriesGrid.innerHTML=state.data.series.map(s=>{const pct=s.chapters?Math.round(s.done/s.chapters*100):0;return`<article class="info-card"><h3>${s.name}</h3><p>${s.done} de ${s.chapters} capítulos</p><div class="progress"><span style="width:${pct}%"></span></div><strong>${pct}% completado</strong></article>`}).join('')}
function renderSchedules(){scheduleList.innerHTML=(state.data.settings.schedules||[]).map((s,i)=>`<div class="schedule-row"><select data-schedule-day="${i}">${DAYS.map((d,idx)=>`<option value="${idx}" ${Number(s.day)===idx?'selected':''}>${d}</option>`).join('')}</select><input data-schedule-time="${i}" type="time" value="${s.time||'10:30'}"/><select data-schedule-type="${i}">${['Culto Dominical','Cena del Señor','Acción de Gracias','Reunión de Oración','Estudio Bíblico','Culto Familiar','Invitado'].map(t=>`<option ${s.type===t?'selected':''}>${t}</option>`).join('')}</select><button class="btn danger" data-schedule-remove="${i}">Eliminar</button></div>`).join('');$$('[data-schedule-day],[data-schedule-time],[data-schedule-type]').forEach(el=>el.addEventListener('change',updateSchedulesFromUI));$$('[data-schedule-remove]').forEach(b=>b.addEventListener('click',async()=>{state.data.settings.schedules.splice(Number(b.dataset.scheduleRemove),1);await save()}))}async function updateSchedulesFromUI(){state.data.settings.schedules=state.data.settings.schedules.map((s,i)=>({...s,day:Number($(`[data-schedule-day="${i}"]`).value),time:$(`[data-schedule-time="${i}"]`).value,type:$(`[data-schedule-type="${i}"]`).value}));await save()}function render(){applyTheme();updateStatus();populateSelects();renderDashboard();renderCalendar();renderEvents();renderPeople();renderGuests();renderSeries();renderSchedules()}
function exportBackup(){const blob=new Blob([JSON.stringify(state.data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`planificacion-liturgica-${today()}.json`;a.click()}function importBackup(file){const r=new FileReader;r.onload=async()=>{try{state.data=merge(defaults(),JSON.parse(r.result));await save();toast('Respaldo importado.')}catch{toast('Archivo inválido.')}};r.readAsText(file)}function bind(){$$('.nav').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));$$('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));document.getElementById('themeToggle').addEventListener('click',async()=>{state.data.theme=state.data.theme==='dark'?'light':'dark';await save()});document.getElementById('loginBtn').addEventListener('click',async()=>{try{await loginGoogle()}catch(e){console.error(e);alert('Error login: '+(e.code||'sin-codigo')+'\n\n'+(e.message||e))}});document.getElementById('logoutBtn').addEventListener('click',async()=>{stopDataSubscription();await logoutGoogle();state.user=null;state.cloudLoaded=false;render()});quickNewEvent.addEventListener('click',()=>openEventModal());newEvent.addEventListener('click',()=>openEventModal());newGuestMeeting.addEventListener('click',()=>openEventModal(true));document.getElementById('saveEvent').addEventListener('click',saveEventData);document.getElementById('deleteEvent').addEventListener('click',removeEventData);editNextBtn.addEventListener('click',()=>editEventModal(state.data.events.find(e=>e.id===state.nextEventId)));document.getElementById('sendNextCalendarBtn').addEventListener('click',()=>sendEventToCalendar(state.nextEventId));document.getElementById('newPerson').addEventListener('click',()=>openPersonModal());document.getElementById('savePerson').addEventListener('click',savePerson);document.getElementById('newGuest').addEventListener('click',()=>openModal('guestModal'));document.getElementById('saveGuest').addEventListener('click',saveGuest);document.getElementById('newSeries').addEventListener('click',()=>openModal('seriesModal'));document.getElementById('saveSeries').addEventListener('click',saveSeries);document.getElementById('prevMonth').addEventListener('click',()=>{state.month--;if(state.month<0){state.month=11;state.year--}render()});document.getElementById('nextMonth').addEventListener('click',()=>{state.month++;if(state.month>11){state.month=0;state.year++}render()});document.getElementById('generateMonth').addEventListener('click',generateMonth);document.getElementById('addSchedule').addEventListener('click',async()=>{state.data.settings.schedules.push({id:uid(),day:0,time:'10:30',type:'Culto Dominical'});await save()});document.getElementById('connectCalendar').addEventListener('click',async()=>{const ok=await connectCalendar();toast(ok?'Google Calendar conectado.':'No se pudo conectar Calendar.');render()});document.getElementById('exportBackup').addEventListener('click',exportBackup);document.getElementById('importBackup').addEventListener('change',e=>{if(e.target.files?.[0])importBackup(e.target.files[0])});document.getElementById('clearLocal').addEventListener('click',()=>{if(confirm('¿Borrar solo los datos locales de este navegador?')){localStorage.removeItem('liturgica-final');location.reload()}})}async function boot(){loadLocal();applyTheme();bind();render();await initFirebase();onAuth(async user=>{state.authResolved=true;state.user=user;if(!user){state.cloudLoaded=false;render();return}try{const cloud=await loadData(user.uid,state.data);state.data=merge(defaults(),cloud);state.cloudLoaded=true;saveLocal();render();subscribeData(user.uid,data=>{state.data=merge(defaults(),data);state.cloudLoaded=true;saveLocal();render()});toast('Sesión iniciada y datos sincronizados.')}catch(e){console.error(e);toast('Error al cargar Firebase.');render()}});await initCalendar();render()}boot();