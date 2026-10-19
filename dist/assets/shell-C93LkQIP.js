import{i as b,a as E}from"./index-CxkAFeET.js";function f(t){return String(t??"").replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}const $=(t,e="NGN")=>new Intl.NumberFormat("en-NG",{style:"currency",currency:e,maximumFractionDigits:0}).format(t/100),I=t=>new Date(t).toLocaleTimeString("en-NG",{timeZone:"Africa/Lagos",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});function D(t,e){t.innerHTML=`
    <div class="kitchen-app staff-app">
      <header class="kitchen-topbar">
        <a class="brand kitchen-brand" href="/">THE IVY <span>PIZZA</span></a>
        <div class="kitchen-top-actions" data-top>
          <span class="kitchen-staff-name" data-name></span>
          <button class="kitchen-top-button" type="button" data-sign-out hidden>Sign out</button>
        </div>
      </header>
      <main class="kitchen-shell ${e.wide?"staff-wide":""}">
        <section class="kitchen-login" data-login>
          <div class="eyebrow dark">${f(e.eyebrow)}</div>
          <h1>${f(e.title)}</h1>
          <p>${f(e.intro)}</p>
          <form data-login-form>
            <label class="form-field">Email address<input name="email" type="email" autocomplete="username" required maxlength="254" /></label>
            <label class="form-field">Password<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128" /></label>
            <button class="btn account-submit" type="submit">Sign in</button>
          </form>
          <p class="kitchen-message" data-login-message role="status" aria-live="polite"></p>
        </section>
        <section class="kitchen-denied" data-denied hidden>
          <div class="eyebrow dark">${f(e.eyebrow)}</div>
          <h1>Access required</h1>
          <p>${f(e.deniedText)}</p>
          <button class="btn" type="button" data-sign-out>Sign out</button>
        </section>
        <section data-board hidden></section>
      </main>
    </div>`;const a=n=>t.querySelector(n),d=a("[data-login]"),w=a("[data-login-form]"),h=a("[data-login-message]"),C=a("[data-denied]"),u=a("[data-board]"),k=a("[data-name]"),S=a("[data-top]");let y=[],v=[],p=0;const q=()=>{y.forEach(n=>window.clearInterval(n)),y=[]};function x(n=""){p+=1,q(),v.forEach(s=>s.remove()),v=[],d.hidden=!1,C.hidden=!0,u.hidden=!0,u.replaceChildren(),k.textContent="",t.querySelectorAll("[data-sign-out]").forEach(s=>{s.closest("header")&&(s.hidden=!0)}),h.textContent=n}async function A(n){if(!n)return x();const s=++p;h.textContent="Checking your access…";try{const r=await fetch(E("/api/me"),{credentials:"include"});if(!r.ok)throw new Error(r.status===401?"Your session expired. Please sign in again.":"Could not verify this account.");const g=await r.json();if(s!==p)return;const l=g.roles.some(i=>e.roles.includes(i));if(d.hidden=!0,C.hidden=l,u.hidden=!l,k.textContent=g.displayName,t.querySelectorAll("header [data-sign-out]").forEach(i=>{i.hidden=!1}),!l)return;const m=document.createElement("p");m.className="kitchen-message",m.setAttribute("role","status"),m.setAttribute("aria-live","polite");const L={profile:g,board:u,request:async(i,c={})=>{const o=new Headers(c.headers);c.body&&o.set("Content-Type","application/json");const T=await fetch(E(i),{...c,headers:o,credentials:"include"});return T.status===401&&x("Your session expired. Sign in again to continue."),T},setMessage:(i,c="info")=>{m.textContent=i,m.dataset.kind=c},addTopButton:(i,c)=>{const o=document.createElement("button");return o.type="button",o.className="kitchen-top-button",o.textContent=i,o.addEventListener("click",c),S.insertBefore(o,S.querySelector("[data-sign-out]")),v.push(o),o},every:(i,c)=>{y.push(window.setInterval(c,i))}};u.replaceChildren(),await e.start(L),u.prepend(m)}catch(r){s===p&&x(r instanceof Error?r.message:"Could not sign in.")}}w.addEventListener("submit",async n=>{n.preventDefault();const s=w.querySelector("button[type=submit]");s.disabled=!0,h.textContent="Signing in…";const r=new FormData(w),{data:g,error:l}=await b.auth.signInWithPassword({email:String(r.get("email")??"").trim(),password:String(r.get("password")??"")});s.disabled=!1,l?h.textContent=/verif|confirm/i.test(l.message)?"Confirm your email address first, then sign in.":l.message:g.session||(h.textContent="Your email address must be confirmed before you can sign in.")}),t.addEventListener("click",async n=>{n.target.closest("[data-sign-out]")&&await b.auth.signOut()}),b.auth.onAuthStateChange((n,s)=>{A(s)}),b.auth.getSession().then(({data:n})=>{A(n.session)})}function F(){try{const t=window.AudioContext??window.webkitAudioContext;if(!t)return;const e=new t,a=e.createOscillator(),d=e.createGain();a.frequency.value=880,d.gain.setValueAtTime(1e-4,e.currentTime),d.gain.exponentialRampToValueAtTime(.3,e.currentTime+.02),d.gain.exponentialRampToValueAtTime(1e-4,e.currentTime+.5),a.connect(d).connect(e.destination),a.start(),a.stop(e.currentTime+.5),a.onended=()=>{e.close()}}catch{}}export{F as b,I as c,f as e,$ as n,D as s};
