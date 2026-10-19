import{s as m,n as c,e as n}from"./shell-C93LkQIP.js";import"./index-CxkAFeET.js";function u(r,d){const o=Math.max(1,...r.map(l=>l.value));return`<div class="owner-bars" role="list" aria-label="${n(d)}">${r.map(l=>`
    <div class="owner-bar" role="listitem"><span class="owner-bar-label">${n(l.label)}</span><span class="owner-bar-track"><i style="width:${Math.round(l.value/o*100)}%"></i></span><span class="owner-bar-value">${n(l.display)}</span></div>`).join("")}</div>`}const i=(r,d,o="")=>`<div class="owner-tile"><span>${n(r)}</span><strong>${n(d)}</strong>${o?`<small>${n(o)}</small>`:""}</div>`;function h(r){let d=1;const o=document.createElement("div");r.board.className="owner-board",r.board.append(o);const l=(s,t)=>{const a=s.summary,$=new Intl.DateTimeFormat("en-GB",{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"}),v=s.byHour.filter(e=>e.orders>0);o.innerHTML=`
      <div class="owner-head">
        <div><div class="eyebrow dark">The Ivy Pizza</div><h1>Sales and service</h1></div>
        <div class="owner-range" role="group" aria-label="Period">${[1,7,30].map(e=>`<button type="button" aria-pressed="${e===d}" data-days="${e}">${e===1?"Today":`${e} days`}</button>`).join("")}</div>
      </div>
      <div class="owner-tiles">
        ${i("Revenue",c(a.revenueMinor),`${a.orders} orders`)}
        ${i("Average order",c(a.averageOrderMinor))}
        ${i("Delivery / pickup",`${a.delivery} / ${a.pickup}`)}
        ${i("In progress now",String(a.inProgress))}
        ${i("Avg prep time",a.averagePrepMinutes===null?"—":`${a.averagePrepMinutes} min`,"accepted → ready")}
        ${i("Avg delivery time",a.averageDeliveryMinutes===null?"—":`${a.averageDeliveryMinutes} min`,"out → delivered")}
        ${i("Late deliveries",String(a.lateOrders),"over ETA + 10 min")}
        ${i("Rating",a.averageRating===null?"—":`${a.averageRating} ★`,`${a.ratings} reviews`)}
        ${i("Rejected / cancelled",`${a.rejected} / ${a.cancelled}`)}
        ${i("Refunds",String(a.refunds),a.refunds?c(a.refundsMinor):"")}
        ${i("Discounts given",c(a.discountsMinor))}
      </div>
      <div class="owner-grid">
        ${s.days>1?`<section class="hr-card"><h2>Revenue by day</h2>${u(s.byDay.map(e=>({label:$.format(new Date(`${e.date}T12:00:00Z`)),value:e.revenueMinor,display:`${c(e.revenueMinor)} · ${e.orders}`})),"Revenue by day")}</section>`:""}
        <section class="hr-card"><h2>Orders by hour</h2>${v.length?u(v.map(e=>({label:`${String(e.hour).padStart(2,"0")}:00`,value:e.orders,display:String(e.orders)})),"Orders by hour"):'<p class="hr-empty">No orders yet.</p>'}</section>
        <section class="hr-card"><h2>Top items</h2>${s.topItems.length?u(s.topItems.map(e=>({label:e.name,value:e.revenueMinor,display:`${c(e.revenueMinor)} · ${e.quantity} sold`})),"Top items"):'<p class="hr-empty">No sales yet.</p>'}</section>
        <section class="hr-card"><h2>Top areas</h2>${s.topAreas.length?u(s.topAreas.map(e=>({label:e.name,value:e.orders,display:`${e.orders} · ${c(e.revenueMinor)}`})),"Top areas"):'<p class="hr-empty">No orders yet.</p>'}</section>
        <section class="hr-card"><h2>Recent reviews</h2>${s.recentReviews.length?`<ul class="owner-reviews">${s.recentReviews.map(e=>`<li><strong>${"★".repeat(e.rating)}${"☆".repeat(5-e.rating)}</strong> <span>${n(e.orderNumber)}</span><p>${n(e.body||"No comment")}</p></li>`).join("")}</ul>`:'<p class="hr-empty">No reviews in this period.</p>'}</section>
        <section class="hr-card"><h2>Open help requests <span class="owner-count">${t.length}</span></h2>${t.length?`<ul class="owner-reviews">${t.map(e=>`<li><strong>${n(e.name)}</strong> <span>${n(e.topic)}${e.orderNumber?` · ${n(e.orderNumber)}`:""}</span><p>${n(e.message)}</p><p class="owner-contact">${n(e.contact)} · <button type="button" class="link-button" data-close="${e.id}">Mark handled</button></p></li>`).join("")}</ul>`:'<p class="hr-empty">Nothing waiting.</p>'}</section>
      </div>`},p=async()=>{try{const[s,t]=await Promise.all([r.request(`/api/owner/report?days=${d}`),r.request("/api/support/requests")]);if(!s.ok)throw new Error("Could not load the report.");const a=await s.json(),$=t.ok?(await t.json()).requests:[];l(a,$),r.setMessage(`Updated ${new Date().toLocaleTimeString("en-NG",{hour:"2-digit",minute:"2-digit"})}`)}catch(s){r.setMessage(s instanceof Error?s.message:"Could not load the report.","error")}};o.addEventListener("click",async s=>{const t=s.target.closest("button");t&&(t.dataset.days&&(d=Number(t.dataset.days),await p()),t.dataset.close&&(await r.request(`/api/support/requests/${t.dataset.close}/close`,{method:"PATCH"}),await p()))}),r.addTopButton("Refresh",()=>{p()}),p(),r.every(6e4,()=>{p()})}function b(r){m(r,{title:"Owner dashboard",eyebrow:"Reports",intro:"Sign in with an owner or manager account to see sales, service times and reviews.",roles:["owner","manager"],deniedText:"This account doesn't have an owner or manager role.",wide:!0,start:h})}export{b as startOwnerScreen};
