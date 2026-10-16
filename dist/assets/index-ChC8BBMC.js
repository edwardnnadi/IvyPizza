(function(){const r=document.createElement("link").relList;if(r&&r.supports&&r.supports("modulepreload"))return;for(const l of document.querySelectorAll('link[rel="modulepreload"]'))i(l);new MutationObserver(l=>{for(const y of l)if(y.type==="childList")for(const b of y.addedNodes)b.tagName==="LINK"&&b.rel==="modulepreload"&&i(b)}).observe(document,{childList:!0,subtree:!0});function p(l){const y={};return l.integrity&&(y.integrity=l.integrity),l.referrerPolicy&&(y.referrerPolicy=l.referrerPolicy),l.crossOrigin==="use-credentials"?y.credentials="include":l.crossOrigin==="anonymous"?y.credentials="omit":y.credentials="same-origin",y}function i(l){if(l.ep)return;l.ep=!0;const y=p(l);fetch(l.href,y)}})();const kt="".replace(/\/+$/,"");function X(o){const r=o.startsWith("/")?o:`/${o}`;return`${kt}${r}`}async function we(o,r){const p=await fetch(X(`/api/auth/${o}`),{method:r===void 0?"GET":"POST",credentials:"include",headers:r===void 0?void 0:{"Content-Type":"application/json"},body:r===void 0?void 0:JSON.stringify(r)}),i=await p.json().catch(()=>({}));if(!p.ok)throw new Error(i.message??i.error??"Authentication request failed.");return i}function Xe(o){return o?{user:{id:o.id,email:o.email,user_metadata:{display_name:o.name??o.email}}}:null}class xt{listeners=new Set;auth={getSession:async()=>{try{const r=await we("get-session");return{data:{session:Xe(r?.user)},error:null}}catch(r){return{data:{session:null},error:r instanceof Error?r:new Error("Could not restore session")}}},signUp:async({email:r,password:p,options:i})=>{try{return await we("sign-up/email",{name:i?.data?.display_name??r,email:r,password:p,callbackURL:i?.emailRedirectTo??window.location.origin}),{data:{session:null},error:null}}catch(l){return{data:{session:null},error:l instanceof Error?l:new Error("Could not create account")}}},signInWithPassword:async({email:r,password:p})=>{try{const i=await we("sign-in/email",{email:r,password:p,callbackURL:window.location.origin}),l=Xe(i.user);return this.emit("SIGNED_IN",l),{data:{session:l},error:null}}catch(i){return{data:{session:null},error:i instanceof Error?i:new Error("Could not sign in")}}},signOut:async()=>{try{return await we("sign-out",{}),this.emit("SIGNED_OUT",null),{error:null}}catch(r){return{error:r instanceof Error?r:new Error("Could not sign out")}}},resetPasswordForEmail:async(r,p=window.location.origin)=>{try{return await we("request-password-reset",{email:r,redirectTo:p}),{error:null}}catch(i){return{error:i instanceof Error?i:new Error("Could not request password reset")}}},resetPassword:async(r,p)=>{try{return await we("reset-password",{token:r,newPassword:p}),{error:null}}catch(i){return{error:i instanceof Error?i:new Error("Could not reset password")}}},onAuthStateChange:r=>(this.listeners.add(r),{data:{subscription:{unsubscribe:()=>this.listeners.delete(r)}}})};emit(r,p){for(const i of this.listeners)i(r,p)}}const Re=new xt,se="cubic-bezier(.16,1,.3,1)",St="cubic-bezier(.65,0,.35,1)",at=window.matchMedia("(prefers-reduced-motion: reduce)"),Ct=window.matchMedia("(max-width: 759px)");function V(){return at.matches}function He(){return Ct.matches}const et=o=>Math.max(0,Math.min(1,o));function tt(o){!o||V()||o.animate([{transform:"scale(1)"},{transform:"scale(1.25)"},{transform:"scale(1)"}],{duration:480,easing:se})}function Et(o,r){if(V()||!o||!r){tt(r);return}const p=o.getBoundingClientRect(),i=r.getBoundingClientRect();if(i.width===0&&i.height===0)return;const l=document.createElement("div");l.className="fly-dot",l.style.left=`${p.left+p.width/2-9}px`,l.style.top=`${p.top+p.height/2-9}px`,document.body.append(l);const y=i.left+i.width/2-(p.left+p.width/2),b=i.top+i.height/2-(p.top+p.height/2),E=Math.min(160,Math.abs(y)*.3+60),A=l.animate([{transform:"translate(0,0) scale(.6)",opacity:0},{transform:`translate(${y*.15}px,${b*.15-E*.6}px) scale(1.1)`,opacity:1,offset:.2},{transform:`translate(${y*.6}px,${b*.6-E}px) scale(1)`,offset:.6},{transform:`translate(${y}px,${b}px) scale(.35)`,opacity:.7}],{duration:720,easing:"cubic-bezier(.45,0,.55,1)"});A.onfinish=()=>{l.remove(),tt(r)}}function qt(o,r){if(V())return;let p=0;o.querySelectorAll("[data-card-id]").forEach(i=>{const l=r.get(i.dataset.cardId??""),y=i.getBoundingClientRect();if(l){const b=l.left-y.left,E=l.top-y.top;(b||E)&&i.animate([{transform:`translate(${b}px,${E}px)`},{transform:"none"}],{duration:600,easing:St})}else i.animate([{opacity:0,transform:"translateY(28px) scale(.96)"},{opacity:1,transform:"none"}],{duration:550,delay:120+p*60,easing:se,fill:"backwards"}),p+=1})}let ze=null;const Te=new WeakMap;function st(o,r){ze??=new IntersectionObserver(p=>{for(const i of p)i.isIntersecting&&(ze?.unobserve(i.target),Te.get(i.target)?.(),Te.delete(i.target))},{rootMargin:"0px 0px -12% 0px"}),Te.set(o,r),ze.observe(o)}function it(o){return o.getBoundingClientRect().top>=window.innerHeight*.9}function At(o){if(V()||!it(o))return;const r=()=>o.querySelectorAll("[data-card-id]");r().forEach(p=>p.style.opacity="0"),st(o,()=>{r().forEach((p,i)=>{p.style.opacity="",p.animate([{opacity:0,transform:"translateY(40px)"},{opacity:1,transform:"none"}],{duration:850,delay:i*70,easing:se,fill:"backwards"})})})}function It(){const o=document.querySelector("#site-nav"),r=document.querySelector("#hero"),p=document.querySelector("#hero-media"),i=document.querySelector("#hero-copy"),l=document.querySelector("#exp-pinned"),y=document.querySelector("#exp-a"),b=document.querySelector("#exp-b"),E=document.querySelector("#exp-t1"),A=document.querySelector("#exp-t2"),M=document.querySelector("#exp-bar"),P=document.querySelector("#exp-cap-a"),T=document.querySelector("#exp-cap-b"),L=document.querySelector("#visit-par"),$=document.querySelector("#menu"),N=document.querySelector("#basket-pill");V()||(document.querySelector("#hero-zoom")?.animate([{transform:"scale(1.1)"},{transform:"scale(1)"}],{duration:2600,easing:se,fill:"forwards"}),document.querySelectorAll("[data-line]").forEach((x,c)=>x.animate([{transform:"translateY(110%)"},{transform:"translateY(0)"}],{duration:1100,delay:250+c*130,easing:se,fill:"both"})),document.querySelectorAll("[data-intro]").forEach((x,c)=>x.animate([{opacity:0,transform:"translateY(18px)"},{opacity:1,transform:"none"}],{duration:900,delay:650+c*110,easing:se,fill:"both"})),document.querySelectorAll("[data-reveal]").forEach(x=>{it(x)&&(x.style.opacity="0",st(x,()=>{x.style.opacity="",x.animate([{opacity:0,transform:"translateY(36px)"},{opacity:1,transform:"none"}],{duration:950,easing:se,fill:"backwards"})}))}));function I(x){if(!(!r||x>r.offsetHeight*1.2)&&(p&&(p.style.transform=`translate3d(0,${x*.35}px,0)`),i)){const c=Math.min(x/(r.offsetHeight*.75),1);i.style.opacity=String(1-c),i.style.transform=`translate3d(0,${x*.12}px,0)`}}function F(x){const c=et((x-.38)/.24),h=c<.5?4*c**3:1-(-2*c+2)**3/2;y&&(y.style.transform=`scale(${1.08-.08*x})`),b&&(b.style.clipPath=`inset(${(1-h)*100}% 0 0 0)`),E&&(E.style.opacity=String(1-h),E.style.transform=`translate3d(0,${-h*40}px,0)`,E.style.visibility=h>.98?"hidden":"visible"),A&&(A.style.opacity=String(h),A.style.transform=`translate3d(0,${(1-h)*40}px,0)`,A.style.visibility=h<.02?"hidden":"visible"),M&&(M.style.transform=`scaleX(${x})`),P?.classList.toggle("is-on",h<.5),T?.classList.toggle("is-on",h>=.5)}let R=!1;function W(){const x=window.scrollY,c=window.innerHeight;if(o?.classList.toggle("is-solid",x>30),!V()){if(I(x),l){const a=l.getBoundingClientRect();a.height>c&&a.top<c&&a.bottom>0&&F(et(-a.top/(a.height-c)))}if(L?.parentElement){const a=L.parentElement.getBoundingClientRect(),n=Math.max(-1,Math.min(1,(a.top+a.height/2-c/2)/c));L.style.transform=`translate3d(0,${n*-6}%,0)`}}let h=!1;if($){const a=$.getBoundingClientRect();h=a.top<c*.5&&a.bottom>c*.5}const k=x>c*.7&&(He()||!h);N&&k!==R&&(R=k,N.classList.toggle("is-visible",k),N.setAttribute("aria-hidden",String(!k)),N.tabIndex=k?0:-1)}let H=!1;const O=()=>{H||(H=!0,requestAnimationFrame(()=>{H=!1,W()}))};window.addEventListener("scroll",O,{passive:!0}),window.addEventListener("resize",O),at.addEventListener("change",()=>{V()&&[p,i,L,y,b,E,A].forEach(x=>x?.removeAttribute("style")),O()}),W()}function Lt(){return document.querySelector("#basket-pill")?.classList.contains("is-visible")??!1}const nt="ivy-pizza-basket-v1",Oe="ivy-pizza-checkout-key-v1",fe=20,De=30;function w(o){const r=document.querySelector(o);if(!r)throw new Error(`Missing element ${o}`);return r}function f(o,r,p){const i=document.createElement(o);return r&&(i.className=r),p!==void 0&&(i.textContent=p),i}function Q(o,r="NGN"){return new Intl.NumberFormat("en-NG",{style:"currency",currency:r,maximumFractionDigits:0}).format(o/100)}function Fe(o){const[r,...p]=o.split("·").map(i=>i.trim());return{label:r??o,detail:p.join(" ").replace(/(\d+)\s*inch(es)?/i,'$1"')}}function $t(o){return o.replace(/s$/i,"")}function ye(o){return`${o.menuItemId}|${[...o.optionIds].sort().join("+")}`}function Mt(o,r){let p=[],i="loading",l=q(),y="All",b=0,E,A=new Map,M=0,P=0,T="NGN",L=new Set;const $=new Map,N=new Map,I=w("#menu-items"),F=w("#basket"),R=w("#basket-scrim"),W=w("#basket-lines"),H=w("#basket-empty"),O=w("#basket-count"),x=w("#basket-subtotal"),c=w("#basket-updating"),h=w("#basket-status"),k=w("#basket-checkout"),a=w("#basket-pill"),n=w("#basket-pill-text"),d=w("#basket-pill-cta"),m=w("#menu-filter-ind"),S=Array.from(document.querySelectorAll("#menu-filters [data-category]"));function q(){try{const e=JSON.parse(localStorage.getItem(nt)??"[]");return Array.isArray(e)?e.filter(t=>typeof t=="object"&&t!==null&&typeof t.menuItemId=="string"&&Number.isInteger(t.quantity)&&t.quantity>=1&&t.quantity<=fe&&Array.isArray(t.optionIds)&&t.optionIds.every(s=>typeof s=="string")).slice(0,De):[]}catch{return[]}}function z(){try{localStorage.setItem(nt,JSON.stringify(l)),localStorage.removeItem(Oe)}catch{}}function D(e,t="info"){h.textContent=e,h.dataset.kind=t}function _(e){return e.available&&e.priceMinor!==null}function B(e){return e.options.filter(t=>t.type==="size"&&t.available&&t.priceDeltaMinor!==null)}function ce(e){return e.options.filter(t=>t.type==="extra"&&t.available&&t.priceDeltaMinor!==null)}function ee(e){let t=$.get(e.id);return t||(t={sizeId:B(e)[0]?.id??null,extraIds:new Set,quantity:1,extrasOpen:!1},$.set(e.id,t)),t}function te(e){const t=ee(e);return[...t.sizeId?[t.sizeId]:[],...t.extraIds]}function ke(e,t){return(e.priceMinor??0)+e.options.filter(s=>t.includes(s.id)).reduce((s,u)=>s+(u.priceDeltaMinor??0),0)}function J(e,t){if(!e)return i==="live"?"No longer on the menu":"";const u=e.options.filter(v=>t.includes(v.id)).sort((v,g)=>v.type===g.type?0:v.type==="size"?-1:1).map(v=>{if(v.type!=="size")return v.name;const{label:g,detail:C}=Fe(v.name);return C?`${g} · ${C}`:g});return u.length?u.join(" · "):"Standard"}function xe(e){const t=S.find(s=>s.dataset.category===y);t&&(e||(m.style.transition="none"),m.style.width=`${t.offsetWidth}px`,m.style.transform=`translateX(${t.offsetLeft}px)`,e||requestAnimationFrame(()=>m.style.transition=""))}function dt(){for(const e of S){const t=e.dataset.category??"All",s=t==="All"?p.length:p.filter(u=>u.category===t).length;e.querySelector(".menu-filter-count").textContent=i==="live"?String(s):""}xe(!1)}function Be(e){if(e===y)return;const t=new Map;I.querySelectorAll("[data-card-id]").forEach(s=>t.set(s.dataset.cardId??"",s.getBoundingClientRect())),y=e;for(const s of S)s.setAttribute("aria-pressed",String(s.dataset.category===e));xe(!0),Ie(),qt(I,t)}function lt(){I.setAttribute("aria-busy","true"),I.replaceChildren(...Array.from({length:6},(e,t)=>{const s=f("div","menu-skeleton");s.setAttribute("aria-hidden","true"),s.style.animationDelay=`${t*.12}s`;for(let u=0;u<6;u+=1)s.append(f("span"));return s}))}function Ie(){if(I.setAttribute("aria-busy",String(i==="loading")),i==="loading"){lt();return}if(i==="error"){const t=f("div","menu-state menu-error");t.setAttribute("role","alert");const s=f("div");s.append(f("p","menu-state-title","We couldn't load the menu."),f("p","menu-state-text","Check your connection and try again."));const u=f("button",void 0,"Try again");u.type="button",u.addEventListener("click",()=>{Ge()}),t.append(s,u),I.replaceChildren(t);return}const e=p.filter(t=>y==="All"||t.category===y);if(e.length===0){const t=f("div","menu-state menu-empty");if(t.append(f("p","menu-state-title",y==="All"?"Nothing on the menu right now.":`No ${y.toLowerCase()} available right now.`),f("p","menu-state-text","Check back soon, or browse the full menu.")),y!=="All"){const s=f("button",void 0,"Show everything");s.type="button",s.addEventListener("click",()=>Be("All")),t.append(s)}I.replaceChildren(t);return}I.replaceChildren(...e.map(ut))}function ut(e){const t=ee(e),s=_(e),u=f("article","menu-card");u.dataset.cardId=e.id,u.setAttribute("aria-label",e.name),u.classList.toggle("is-unavailable",!s);const v=f("div","menu-card-top");v.append(f("span","menu-card-cat",$t(e.category))),s||v.append(f("span","menu-card-badge",e.priceMinor===null?"Coming soon":"Sold out today")),u.append(v,f("h3",void 0,e.name),f("p","menu-card-desc",e.description)),u.append(f("p","menu-card-from",e.priceMinor===null?"Price coming soon":`From ${Q(e.priceMinor,e.currency)}`));const g=f("button","add-btn");g.type="button";const C=()=>{if(!s){g.textContent="Unavailable";return}if(u.classList.contains("is-added")){g.textContent="Added ✓";return}g.textContent=`Add · ${Q(ke(e,te(e))*t.quantity,e.currency)}`},Y=B(e);if(Y.length){const K=f("fieldset","size-chips"),j=f("legend","visually-hidden",`Size for ${e.name}`);K.append(j);for(const U of Y){const{label:pe,detail:Ae}=Fe(U.name),me=f("label","size-chip"),Z=f("input");Z.type="radio",Z.name=`size-${e.id}`,Z.value=U.id,Z.checked=t.sizeId===U.id,Z.disabled=!s,Z.addEventListener("change",()=>{t.sizeId=U.id,C()}),me.append(Z,f("span","size-chip-name",Ae?`${pe} ${Ae}`:pe),f("span","size-chip-extra",U.priceDeltaMinor?`+${Q(U.priceDeltaMinor,e.currency)}`:"Base")),K.append(me)}u.append(K)}const G=ce(e);if(G.length){const K=f("div","extras"),j=f("button","extras-toggle");j.type="button",j.disabled=!s;const U=f("span"),pe=f("span","extras-plus","+");pe.setAttribute("aria-hidden","true"),j.append(U,pe);const Ae=`extras-${e.id}`;j.setAttribute("aria-controls",Ae);const me=f("div","extras-panel");me.id=Ae;const Z=f("div"),Pe=f("fieldset","extras-list");Pe.append(f("legend","visually-hidden",`Extras for ${e.name}`));const Ne=()=>{j.setAttribute("aria-expanded",String(t.extrasOpen)),me.classList.toggle("is-open",t.extrasOpen),U.textContent=t.extraIds.size?`Extras · ${t.extraIds.size} added`:`Add extras (${G.length})`};for(const ve of G){const Je=f("label"),he=f("input");he.type="checkbox",he.value=ve.id,he.checked=t.extraIds.has(ve.id),he.disabled=!s,he.addEventListener("change",()=>{he.checked?t.extraIds.add(ve.id):t.extraIds.delete(ve.id),Ne(),C()});const Ze=f("span",void 0,`${ve.name} `);Ze.append(f("span","price",`+${Q(ve.priceDeltaMinor,e.currency)}`)),Je.append(he,Ze),Pe.append(Je)}j.addEventListener("click",()=>{t.extrasOpen=!t.extrasOpen,Ne()}),Z.append(Pe),me.append(Z),K.append(j,me),Ne(),u.append(K)}const ge=f("div","menu-card-actions"),be=f("div","stepper");be.setAttribute("role","group"),be.setAttribute("aria-label",`Quantity for ${e.name}`);const ue=f("button",void 0,"−"),re=f("button",void 0,"+"),Me=f("output");ue.type=re.type="button",ue.setAttribute("aria-label",`Decrease quantity of ${e.name}`),re.setAttribute("aria-label",`Increase quantity of ${e.name}`);const ne=()=>{Me.textContent=String(t.quantity),ue.disabled=!s||t.quantity<=1,re.disabled=!s||t.quantity>=fe,C()};return ue.addEventListener("click",()=>{t.quantity=Math.max(1,t.quantity-1),ne()}),re.addEventListener("click",()=>{t.quantity=Math.min(fe,t.quantity+1),ne()}),be.append(ue,Me,re),g.disabled=!s,g.addEventListener("click",()=>{Ye(e,te(e),t.quantity,g)&&(t.quantity=1,u.classList.add("is-added"),ne(),window.clearTimeout(N.get(e.id)),N.set(e.id,window.setTimeout(()=>{u.classList.remove("is-added"),C()},1600)))}),ge.append(be,g),u.append(ge),ne(),u}function Ye(e,t,s,u){if(!_(e))return!1;const v=ye({menuItemId:e.id,optionIds:t}),g=l.find(G=>ye(G)===v);if(g){if(g.quantity+s>fe)return D(`A basket line can hold up to ${fe} of the same item.`,"error"),!1;g.quantity+=s}else{if(l.length>=De)return D(`Your basket has reached its ${De} line limit.`,"error"),!1;l.push({menuItemId:e.id,quantity:s,optionIds:t})}z(),ie();const C=e.options.find(G=>G.type==="size"&&t.includes(G.id));D(`Added ${s} × ${e.name}${C?` (${Fe(C.name).label})`:""} to your basket.`);const Y=Lt()?n:He()?null:O;return Et(u,Y),Le(0),!0}function _e(e,t){const s=l.find(u=>ye(u)===e);s&&(s.quantity=Math.max(1,Math.min(fe,s.quantity+t)),z(),D(""),ie(),Le(250))}function pt(e,t){const s=p.find(v=>v.id===l.find(g=>ye(g)===e)?.menuItemId),u=()=>{l=l.filter(v=>ye(v)!==e),z(),D(s?`Removed ${s.name}.`:"Removed."),ie(),Le(0)};if(V()){u();return}t.animate([{opacity:1,transform:"none"},{opacity:0,transform:"translateX(-24px)"}],{duration:260,easing:"ease-in",fill:"forwards"}).onfinish=u}function je(){return l.reduce((e,t)=>e+t.quantity,0)}function We(){const e=je();n.textContent=e===0?"Start your order":`${e===1?"1 item":`${e} items`} · ${Q(M,T)}`,d.textContent=e===0?"Menu →":"View basket"}function ie(){const e=je();O.textContent=e===1?"1 item":`${e} items`,H.hidden=l.length>0,k.disabled=l.length===0;const t=new Set,s=l.map(g=>{const C=ye(g);t.add(C);const Y=p.find(pe=>pe.id===g.menuItemId),G=f("li","basket-line");G.dataset.lineId=C;const ge=f("div");ge.style.minWidth="0",ge.append(f("p","basket-line-name",Y?.name??(i==="loading"?"Loading…":"Menu item")),f("p","basket-line-opts",J(Y,g.optionIds)));const be=A.get(`${C}#${g.quantity}`),ue=Y&&_(Y)?ke(Y,g.optionIds)*g.quantity:null,re=be??ue,Me=f("p","basket-line-total",re===null?"—":Q(re,T)),ne=f("div","stepper");ne.setAttribute("role","group"),ne.setAttribute("aria-label",`Quantity for ${Y?.name??"menu item"}`);const K=f("button",void 0,"−"),j=f("button",void 0,"+");K.type=j.type="button",K.setAttribute("aria-label",`Decrease quantity of ${Y?.name??"menu item"}`),j.setAttribute("aria-label",`Increase quantity of ${Y?.name??"menu item"}`),K.disabled=g.quantity<=1,j.disabled=g.quantity>=fe,K.addEventListener("click",()=>_e(C,-1)),j.addEventListener("click",()=>_e(C,1)),ne.append(K,f("output",void 0,String(g.quantity)),j);const U=f("button","basket-remove","Remove");return U.type="button",U.setAttribute("aria-label",`Remove ${Y?.name??"menu item"} from basket`),U.addEventListener("click",()=>pt(C,G)),G.append(ge,Me,ne,U),G}),u=document.activeElement?.closest("[data-line-id]")?.dataset.lineId,v=document.activeElement?.getAttribute("aria-label");if(W.replaceChildren(...s),u&&v&&W.querySelector(`[data-line-id="${CSS.escape(u)}"] [aria-label="${CSS.escape(v)}"]`)?.focus(),!V())for(const g of s)L.has(g.dataset.lineId??"")||g.animate([{opacity:0,transform:"translateX(18px)"},{opacity:1,transform:"none"}],{duration:500,easing:se});L=t,l.length===0&&(b+=1,Se(!1),Ue(0)),We()}function Se(e){c.hidden=!e,F.classList.toggle("is-calculating",e)}function Ue(e){cancelAnimationFrame(P);const t=M,s=g=>{M=g,x.textContent=Q(g,T),We()};if(V()||t===e){s(e);return}const u=performance.now(),v=g=>{const C=Math.min((g-u)/600,1),Y=1-(1-C)**3;s(Math.round((t+(e-t)*Y)/100)*100),C<1?P=requestAnimationFrame(v):s(e)};P=requestAnimationFrame(v)}function Le(e){window.clearTimeout(E),l.length!==0&&(Se(!0),E=window.setTimeout(()=>{mt()},e))}async function mt(){const e=++b;if(l.length!==0){Se(!0);try{const t=await fetch(X("/api/menu/quote"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:l})}),s=await t.json();if(e!==b)return;if(!t.ok)throw new Error("error"in s&&s.error?s.error:"We could not check the basket prices.");const u=s;T=u.currency,A=new Map(l.map((v,g)=>{const C=u.lines[g];return[`${ye(v)}#${v.quantity}`,C&&C.menuItemId===v.menuItemId?C.lineTotalMinor:NaN]}).filter(([,v])=>Number.isFinite(v))),Se(!1),ie(),Ue(u.subtotalMinor)}catch(t){if(e!==b)return;Se(!1),x.textContent="—",D(t instanceof Error?t.message:"We could not check the basket prices. Refresh the menu and try again.","error")}}}function ht(){F.classList.add("is-open"),R.classList.add("is-open"),document.body.style.overflow="hidden",window.setTimeout(()=>w("#basket-close").focus(),60)}function Ce(e=!0){F.classList.contains("is-open")&&(F.classList.remove("is-open"),R.classList.remove("is-open"),document.body.style.overflow="",e&&a.classList.contains("is-visible")&&a.focus())}function ft(){const e=w("#menu");window.scrollTo({top:e.getBoundingClientRect().top+window.scrollY-70,behavior:V()?"auto":"smooth"})}a.addEventListener("click",()=>{l.length===0||!He()?ft():ht()}),R.addEventListener("click",()=>Ce()),w("#basket-close").addEventListener("click",()=>Ce()),document.addEventListener("keydown",e=>{e.key==="Escape"&&!document.querySelector("dialog[open]")&&Ce()}),window.matchMedia("(max-width: 759px)").addEventListener("change",()=>{Ce(!1),xe(!1)}),window.addEventListener("resize",()=>xe(!1)),document.fonts?.ready.then(()=>xe(!1));for(const e of S)e.addEventListener("click",()=>Be(e.dataset.category??"All"));function yt(){const e=w("#hero-chip"),t=p.find(u=>_(u)&&(u.slug?.includes("suya")||/suya/i.test(u.name)))??p.find(_);if(!t){e.hidden=!0;return}w("#hero-chip-name").textContent=t.name,w("#hero-chip-price").textContent=`From ${Q(t.priceMinor,t.currency)}`;const s=w("#hero-chip-add");s.onclick=()=>{const u=B(t)[0];Ye(t,u?[u.id]:[],1,s)},e.hidden=!1,V()||e.animate([{opacity:0,transform:"translateY(18px)"},{opacity:1,transform:"none"}],{duration:900,easing:se})}async function Ge(){i="loading",Ie();try{const e=await fetch(X("/api/menu"));if(!e.ok)throw new Error("Menu is temporarily unavailable.");p=(await e.json()).items??[],T=p[0]?.currency??T,i="live",Ie(),At(I),yt(),ie(),l.length&&Le(0)}catch{i="error",Ie(),ie()}dt()}const de=w("#checkout-dialog"),le=w("#checkout-form"),Ke=w("#checkout-message"),Qe=w("#checkout-success"),$e=w("#saved-address-select"),Ve=w("#saved-address-field"),gt=w("#saved-address-label-field");let Ee=[];function oe(e,t="info"){Ke.textContent=e,Ke.dataset.kind=t}function qe(e,t){const s=le.elements.namedItem(e);(s instanceof HTMLInputElement||s instanceof HTMLTextAreaElement)&&(s.value=t)}async function bt(e){Ee=[],$e.replaceChildren(new Option("Enter a new delivery address","")),Ve.hidden=!0;try{const t=await fetch(X("/api/customer/addresses"),{credentials:"include"});if(!t.ok)return;Ee=(await t.json()).addresses??[];for(const u of Ee)$e.add(new Option(`${u.label} · ${u.address}`,u.id));Ve.hidden=Ee.length===0}catch{}}async function vt(){oe("Checking the latest prices and delivery estimate…");try{const e=await fetch(X("/api/menu/quote"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:l})}),t=await e.json();if(!e.ok)throw new Error("error"in t&&t.error?t.error:"Could not calculate the order total.");const s=t;w("#checkout-subtotal").textContent=Q(s.subtotalMinor,s.currency),w("#checkout-delivery").textContent=Q(s.deliveryFeeMinor,s.currency),w("#checkout-tax").textContent=Q(s.taxMinor,s.currency),w("#checkout-total").textContent=Q(s.totalMinor,s.currency),oe("Totals are recalculated when the order is placed.")}catch(e){oe(e instanceof Error?e.message:"Could not calculate the order total.","error")}}async function wt(){if(!l.length)return;if(Ce(!1),!o){D("Sign in is required to place an order, and account access is not configured yet.","error"),r();return}const{data:e,error:t}=await o.auth.getSession();if(t||!e.session){D("Sign in or create an account to continue to checkout."),r();return}le.hidden=!1,Qe.hidden=!0,oe("");const s=le.elements.namedItem("recipientName");if(s instanceof HTMLInputElement&&!s.value){const u=e.session.user.user_metadata?.display_name;s.value=typeof u=="string"?u:""}await bt(e.session),de.showModal(),vt()}$e.addEventListener("change",()=>{const e=Ee.find(t=>t.id===$e.value);e&&(qe("recipientName",e.recipientName),qe("phone",e.phone),qe("address",e.address),qe("landmark",e.landmark??""),qe("instructions",e.instructions??""))}),le.querySelector('[name="saveAddress"]')?.addEventListener("change",e=>{const t=e.currentTarget;t instanceof HTMLInputElement&&(gt.hidden=!t.checked)}),le.addEventListener("submit",async e=>{e.preventDefault();const t=w("#checkout-submit");if(!o){oe("Account access is not configured yet.","error");return}const{data:s}=await o.auth.getSession();if(!s.session){oe("Your session expired. Sign in again to place this order.","error"),de.close(),r();return}t.disabled=!0,oe("Submitting your order…");try{let u=localStorage.getItem(Oe);u||(u=crypto.randomUUID(),localStorage.setItem(Oe,u));const v=new FormData(le),g=await fetch(X("/api/orders"),{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({idempotencyKey:u,items:l,delivery:{recipientName:String(v.get("recipientName")??""),phone:String(v.get("phone")??""),address:String(v.get("address")??""),landmark:String(v.get("landmark")??""),instructions:String(v.get("instructions")??"")},saveAddress:v.get("saveAddress")==="on",addressLabel:String(v.get("addressLabel")??"Home")})}),C=await g.json();if(!g.ok)throw new Error(C.existingOrderNumber?`${C.error??"This checkout was already used."} Earlier order: ${C.existingOrderNumber}.`:C.error??"Could not submit your order.");w("#checkout-order-number").textContent=C.orderNumber,w("#checkout-order-status").textContent=C.paymentStatus==="pending"?"Your order is awaiting staff review. Payment is pending; no payment has been collected.":"Your order has been received.",le.hidden=!0,Qe.hidden=!1,l=[],z(),D(""),ie()}catch(u){oe(u instanceof Error?u.message:"Could not submit your order. You can retry safely.","error")}finally{t.disabled=!1}}),k.addEventListener("click",()=>{wt()}),w("#checkout-close").addEventListener("click",()=>de.close()),w("#checkout-done").addEventListener("click",()=>de.close()),de.addEventListener("click",e=>{e.target===de&&de.close()}),ie(),Ge()}const Pt=`
  <div class="site">
  <header class="site-nav" id="site-nav">
    <div class="site-nav-inner">
      <a class="site-logo" href="#top" aria-label="The Ivy Pizza, back to top">THE IVY <span>PIZZA</span></a>
      <nav class="site-links" aria-label="Primary"><a href="#menu">Menu</a><a href="#experience">Experience</a><a href="#visit">Visit us</a></nav>
      <div class="site-nav-actions">
        <a class="site-nav-menu" href="#menu">Menu</a>
        <button class="account-trigger" id="account-open" type="button">My account</button>
      </div>
    </div>
  </header>
  <main id="top">
    <section class="hero" id="hero" aria-label="Welcome">
      <div class="hero-media" id="hero-media">
        <div class="hero-zoom" id="hero-zoom">
          <picture>
            <source media="(max-width: 759px)" srcset="/ivy-hero-1200.webp" />
            <img src="/ivy-hero.webp" width="1536" height="1024" fetchpriority="high" decoding="async" alt="An Ivy Suya pizza on a wooden board beside an Ivy Pizza box, jollof rice, plantain, suya skewers and salsa" />
          </picture>
        </div>
      </div>
      <div class="hero-overlay" aria-hidden="true"></div>
      <div class="hero-copy" id="hero-copy">
        <p class="eyebrow on-dark" data-intro>Pizza • Burgers • Fast delivery</p>
        <h1>
          <span class="line-mask"><span class="line" data-line>Abuja's new</span></span>
          <span class="line-mask"><span class="line" data-line>pizza <em>ritual.</em></span></span>
        </h1>
        <p class="hero-lead" data-intro>Premium fast food with unmistakable Ivy character: signature pizzas, flame-grilled burgers and a faster way to collect your favourites.</p>
        <div class="hero-ctas" data-intro>
          <a class="pill-btn gold" href="#menu">Explore the menu <span aria-hidden="true">→</span></a>
          <a class="pill-btn ghost-light" href="#visit">Find The Ivy Pizza</a>
        </div>
      </div>
      <div class="hero-chip" id="hero-chip" hidden>
        <div class="hero-chip-text"><span class="hero-chip-name" id="hero-chip-name"></span><span class="hero-chip-price" id="hero-chip-price"></span></div>
        <button type="button" id="hero-chip-add">Add to basket</button>
      </div>
    </section>

    <div class="strip" aria-label="Why The Ivy">
      <div class="strip-track">
        <ul><li>Freshly prepared</li><li>Quick pickup</li><li>Delivery ready</li><li>Made for Abuja</li></ul>
        <ul class="strip-dup" aria-hidden="true"><li>Freshly prepared</li><li>Quick pickup</li><li>Delivery ready</li><li>Made for Abuja</li></ul>
      </div>
    </div>

    <section id="experience" aria-labelledby="exp-title">
      <div class="exp-pinned" id="exp-pinned">
        <div class="exp-stage">
          <div class="exp-photo">
            <div class="exp-a" id="exp-a"><img src="/ivy-dining.webp" width="1400" height="788" loading="lazy" decoding="async" alt="The Ivy Pizza dining room" /></div>
            <div class="exp-b" id="exp-b"><img src="/ivy-pickup.webp" width="1400" height="788" loading="lazy" decoding="async" alt="The Ivy Pizza pickup counter" /></div>
            <div class="exp-caps" aria-hidden="true"><span class="is-on" id="exp-cap-a">Dining room</span><span id="exp-cap-b">Pickup counter</span></div>
          </div>
          <div class="exp-copy">
            <div class="exp-beats">
              <div class="exp-beat" id="exp-t1">
                <p class="eyebrow">The Ivy experience</p>
                <h2 class="exp-title" id="exp-title">Fast food, beautifully done.</h2>
                <p class="lead">The Ivy Pizza brings together a quick-service pizza kitchen, flame-grilled classics and a warm space to dine, collect and go.</p>
              </div>
              <div class="exp-beat" id="exp-t2">
                <p class="eyebrow">Collect and go</p>
                <h2 class="exp-title">Ready when you are.</h2>
                <p class="lead">A dedicated pickup counter keeps collections quick, so your order is waiting the moment you walk in.</p>
              </div>
            </div>
            <div class="exp-progress" aria-hidden="true"><span>01</span><span class="exp-progress-track"><span class="exp-progress-bar" id="exp-bar"></span></span><span>02</span></div>
          </div>
        </div>
      </div>
      <div class="exp-static wrap">
        <p class="eyebrow">The Ivy experience</p>
        <h2 class="exp-title">Fast food, beautifully done.</h2>
        <p class="lead">The Ivy Pizza brings together a quick-service pizza kitchen, flame-grilled classics and a warm space to dine, collect and go.</p>
        <div class="exp-gallery">
          <img src="/ivy-dining.webp" width="1400" height="788" loading="lazy" decoding="async" alt="The Ivy Pizza dining room" />
          <img src="/ivy-pickup.webp" width="1400" height="788" loading="lazy" decoding="async" alt="The Ivy Pizza pickup counter" />
        </div>
      </div>
    </section>

    <section class="menu-section" id="menu" aria-labelledby="menu-title">
      <div class="wrap">
        <div class="menu-head">
          <div data-reveal>
            <p class="eyebrow on-dark">Our menu</p>
            <h2 class="menu-title" id="menu-title">Made to order.<br />Made your way.</h2>
          </div>
          <div class="menu-filters" id="menu-filters" role="group" aria-label="Filter menu by category">
            <span class="menu-filter-ind" id="menu-filter-ind" aria-hidden="true"></span>
            <button class="menu-filter" type="button" data-category="All" aria-pressed="true">All <span class="menu-filter-count"></span></button>
            <button class="menu-filter" type="button" data-category="Pizzas" aria-pressed="false">Pizzas <span class="menu-filter-count"></span></button>
            <button class="menu-filter" type="button" data-category="Burgers" aria-pressed="false">Burgers <span class="menu-filter-count"></span></button>
          </div>
        </div>
        <div class="menu-layout">
          <div class="menu-main">
            <div class="menu-grid" id="menu-items" aria-live="polite" aria-busy="true"></div>
            <p class="menu-note">Prices shown are development samples. Final prices and availability will be confirmed before launch.</p>
          </div>
          <div class="basket-scrim" id="basket-scrim" aria-hidden="true"></div>
          <aside class="basket" id="basket" aria-labelledby="basket-title">
            <span class="basket-grabber" aria-hidden="true"></span>
            <div class="basket-head">
              <div><p class="eyebrow">Your selection</p><h3 id="basket-title">Basket</h3></div>
              <div class="basket-head-right">
                <span class="basket-count" id="basket-count">0 items</span>
                <button class="basket-close" id="basket-close" type="button" aria-label="Close basket">×</button>
              </div>
            </div>
            <div class="basket-body">
              <div class="basket-empty" id="basket-empty"><p>Your basket is empty.</p><p>Pick a pizza or burger to get started.</p></div>
              <ul class="basket-lines" id="basket-lines"></ul>
            </div>
            <div class="basket-foot">
              <div class="basket-total">
                <span class="basket-total-label">Subtotal <span class="basket-updating" id="basket-updating" hidden>Updating…</span></span>
                <strong class="basket-subtotal" id="basket-subtotal">₦0</strong>
              </div>
              <p class="basket-status" id="basket-status" role="status" aria-live="polite"></p>
              <button class="pill-btn gold basket-checkout" id="basket-checkout" type="button" disabled>Continue to checkout</button>
            </div>
          </aside>
        </div>
      </div>
    </section>

    <section class="visit-section" id="visit" aria-labelledby="visit-title">
      <div class="wrap visit-grid">
        <div class="visit-photo" data-reveal>
          <div class="visit-photo-par" id="visit-par"><img src="/ivy-open-kitchen.webp" width="1200" height="675" loading="lazy" decoding="async" alt="The Ivy Pizza open kitchen and counter" /></div>
        </div>
        <div data-reveal>
          <p class="eyebrow">Order your way</p>
          <h2 class="visit-title" id="visit-title">Eat in, pick up or get it delivered.</h2>
          <p class="lead">Our open kitchen, dedicated collection point and delivery-ready setup are designed for your day. Location, opening hours and online ordering will be announced soon.</p>
          <ol class="visit-ways">
            <li><span>01</span><span>Eat in</span></li>
            <li><span>02</span><span>Pick up</span></li>
            <li><span>03</span><span>Delivery</span></li>
          </ol>
          <div class="visit-ctas">
            <a class="pill-btn green" href="mailto:hello@theivypizza.com?subject=The%20Ivy%20Pizza%20enquiry">Contact us <span aria-hidden="true">→</span></a>
            <a class="pill-btn ghost-dark" href="#menu">Browse the menu</a>
          </div>
        </div>
      </div>
    </section>
  </main>
  <footer class="site-footer">
    <div class="site-footer-inner">
      <span class="site-logo">THE IVY <span>PIZZA</span></span>
      <div class="site-footer-meta"><span>Pizza • Burgers • Abuja</span><span>Coming soon</span></div>
    </div>
  </footer>

  <button class="basket-pill" id="basket-pill" type="button" aria-hidden="true" tabindex="-1">
    <span class="basket-pill-text" id="basket-pill-text">Start your order</span>
    <span class="basket-pill-cta" id="basket-pill-cta">Menu →</span>
  </button>

  <dialog class="ivy-dialog" id="account-dialog" aria-labelledby="account-title">
    <div class="ivy-panel">
      <button class="ivy-close" id="account-close" type="button" aria-label="Close account dialog">×</button>
      <p class="eyebrow">The Ivy Pizza</p>
      <h2 id="account-title">Your account</h2>
      <p class="ivy-intro" id="account-intro">Sign in to your Ivy account or create one to get started.</p>
      <div class="ivy-tabs" id="account-tabs" role="tablist" aria-label="Account access" data-mode="signin">
        <button type="button" data-mode="signin" role="tab" aria-selected="true">Sign in</button>
        <button type="button" data-mode="signup" role="tab" aria-selected="false">Create account</button>
        <span class="ivy-tabs-ind" aria-hidden="true"></span>
      </div>
      <form id="auth-form">
        <div class="ivy-expand" id="name-field"><div>
          <label class="ivy-field">Full name<input name="display_name" autocomplete="name" maxlength="100" /></label>
        </div></div>
        <label class="ivy-field">Email address<input name="email" type="email" autocomplete="email" required maxlength="254" /></label>
        <label class="ivy-field">Password<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128" /></label>
          <button class="auth-inline-link" id="forgot-password" type="button">Forgot password?</button>
        <button class="ivy-submit" id="auth-submit" type="submit">Sign in</button>
      </form>
      <form id="password-reset-form" hidden>
        <label class="ivy-field">New password<input name="newPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128" /></label>
        <button class="ivy-submit" type="submit">Save new password</button>
      </form>
      <div id="profile-card" hidden>
        <div class="profile">
          <span class="profile-initial" id="profile-initial" aria-hidden="true"></span>
          <div style="min-width:0">
            <p class="profile-name" id="profile-name"></p>
            <p class="profile-email" id="profile-email"></p>
            <p class="profile-roles" id="profile-roles"></p>
          </div>
        </div>
        <section class="customer-dashboard" aria-labelledby="dashboard-heading">
          <div class="dashboard-summary">
            <div><strong id="dashboard-order-count">—</strong><span>Orders placed</span></div>
            <div><strong id="dashboard-active-count">—</strong><span>In progress</span></div>
          </div>
          <div class="dashboard-block">
            <h3 id="dashboard-heading">Your orders</h3>
            <div class="dashboard-orders" id="dashboard-orders" aria-live="polite"><p>Loading your order history…</p></div>
          </div>
          <div class="dashboard-block">
            <h3>Popular picks</h3>
            <div class="dashboard-picks" id="dashboard-picks"></div>
          </div>
        </section>
        <button class="ivy-submit outline" id="sign-out" type="button">Sign out</button>
      </div>
      <p class="ivy-message" id="auth-message" role="status" aria-live="polite"></p>
      <p class="ivy-config-note" id="auth-config-note" hidden>Account access is being configured. Please try again later.</p>
    </div>
  </dialog>

  <dialog class="ivy-dialog checkout-dialog" id="checkout-dialog" aria-labelledby="checkout-title">
    <div class="ivy-panel">
      <button class="ivy-close" id="checkout-close" type="button" aria-label="Close checkout">×</button>
      <p class="eyebrow">Delivery details</p>
      <h2 id="checkout-title">Checkout</h2>
      <form id="checkout-form">
        <label class="ivy-field" id="saved-address-field" hidden>Use a saved address
          <select id="saved-address-select"><option value="">Enter a new delivery address</option></select>
        </label>
        <label class="ivy-field">Recipient name<input name="recipientName" autocomplete="name" required maxlength="100" /></label>
        <label class="ivy-field">Delivery phone<input name="phone" type="tel" autocomplete="tel" required maxlength="24" /></label>
        <label class="ivy-field">Delivery address<textarea name="address" autocomplete="street-address" required maxlength="500" rows="3"></textarea></label>
        <label class="ivy-field">Landmark <span class="optional">Optional</span><input name="landmark" maxlength="200" /></label>
        <label class="ivy-field">Delivery instructions <span class="optional">Optional</span><textarea name="instructions" maxlength="500" rows="2"></textarea></label>
        <label class="checkout-save"><input name="saveAddress" type="checkbox" /> Save this address to my account</label>
        <label class="ivy-field" id="saved-address-label-field" hidden>Address label<input name="addressLabel" value="Home" maxlength="60" /></label>
        <div class="checkout-breakdown" aria-label="Order total breakdown">
          <div><span>Items</span><strong id="checkout-subtotal">—</strong></div>
          <div><span>Delivery</span><strong id="checkout-delivery">—</strong></div>
          <div><span>Tax</span><strong id="checkout-tax">—</strong></div>
          <div class="checkout-total"><span>Total due later</span><strong id="checkout-total">—</strong></div>
        </div>
        <p class="checkout-note">Development estimate. Payment is not collected in this phase; final delivery and tax settings must be confirmed before launch.</p>
        <p class="ivy-message" id="checkout-message" role="status" aria-live="polite"></p>
        <button class="ivy-submit" id="checkout-submit" type="submit">Place order</button>
      </form>
      <section class="checkout-success" id="checkout-success" hidden>
        <div class="checkout-success-mark" aria-hidden="true">✓</div>
        <h3>Order received</h3>
        <p>Your order number is <strong id="checkout-order-number"></strong>.</p>
        <p id="checkout-order-status">Payment is pending. No payment has been collected.</p>
        <button class="ivy-submit" id="checkout-done" type="button">Done</button>
      </section>
    </div>
  </dialog>
  </div>
`,ot=document.querySelector("#app");if(!ot)throw new Error("Application root was not found.");const ae=Re,Nt=`
  <div class="kitchen-app">
    <header class="kitchen-topbar">
      <a class="brand kitchen-brand" href="/">THE IVY <span>PIZZA</span></a>
      <div class="kitchen-top-actions">
        <span class="kitchen-staff-name" id="kitchen-staff-name"></span>
        <button class="kitchen-top-button" id="kitchen-refresh" type="button" hidden>Refresh queue</button>
        <button class="kitchen-top-button" id="kitchen-sign-out" type="button" hidden>Sign out</button>
      </div>
    </header>
    <main class="kitchen-shell">
      <section class="kitchen-login" id="kitchen-login">
        <div class="eyebrow dark">Staff access</div>
        <h1>Kitchen screen</h1>
        <p>Sign in with your Ivy staff account to view active orders.</p>
        <form id="kitchen-login-form">
          <label class="form-field">Email address<input name="email" type="email" autocomplete="username" required maxlength="254" /></label>
          <label class="form-field">Password<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128" /></label>
          <button class="btn account-submit" id="kitchen-login-submit" type="submit">Sign in</button>
        </form>
        <p class="kitchen-message" id="kitchen-login-message" role="status" aria-live="polite"></p>
        <p class="auth-config-note" id="kitchen-config-note" hidden>Staff sign-in is not configured. Please contact the site administrator.</p>
      </section>
      <section class="kitchen-denied" id="kitchen-denied" hidden>
        <div class="eyebrow dark">Staff access</div>
        <h1>Kitchen access required</h1>
        <p>This account does not have a kitchen, manager, or owner role. Ask an owner to grant the correct staff role.</p>
        <button class="btn" id="kitchen-denied-sign-out" type="button">Sign out</button>
      </section>
      <section class="kitchen-board" id="kitchen-board" hidden>
        <div class="kitchen-board-heading">
          <div><div class="eyebrow dark">The Ivy Pizza</div><h1>Kitchen queue</h1><p>Active orders, oldest first. The queue refreshes automatically.</p></div>
          <div class="kitchen-live"><span></span> Live queue</div>
        </div>
        <p class="kitchen-message" id="kitchen-queue-message" role="status" aria-live="polite"></p>
        <div class="kitchen-order-grid" id="kitchen-order-grid" aria-live="polite"></div>
      </section>
    </main>
  </div>
`,zt=`
  <div class="kitchen-app">
    <header class="kitchen-topbar">
      <a class="brand kitchen-brand" href="/">THE IVY <span>PIZZA</span></a>
      <div class="kitchen-top-actions">
        <span class="kitchen-staff-name" id="hr-staff-name"></span>
        <button class="kitchen-top-button" id="hr-refresh" type="button" hidden>Refresh staff</button>
        <button class="kitchen-top-button" id="hr-sign-out" type="button" hidden>Sign out</button>
      </div>
    </header>
    <main class="kitchen-shell hr-shell">
      <section class="kitchen-login" id="hr-login">
        <div class="eyebrow dark">Human resources</div>
        <h1>Staff access</h1>
        <p>Sign in with an HR or owner account to manage employed staff and their roles.</p>
        <form id="hr-login-form">
          <label class="form-field">Email address<input name="email" type="email" autocomplete="username" required maxlength="254" /></label>
          <label class="form-field">Password<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128" /></label>
          <button class="btn account-submit" id="hr-login-submit" type="submit">Sign in</button>
        </form>
        <p class="kitchen-message" id="hr-login-message" role="status" aria-live="polite"></p>
        <p class="auth-config-note" id="hr-config-note" hidden>Staff sign-in is not configured. Please contact the site administrator.</p>
      </section>
      <section class="kitchen-denied" id="hr-denied" hidden>
        <div class="eyebrow dark">Human resources</div>
        <h1>HR access required</h1>
        <p>This account does not have an HR or owner role. Ask an owner to grant the correct access.</p>
        <button class="btn" id="hr-denied-sign-out" type="button">Sign out</button>
      </section>
      <section class="hr-board" id="hr-board" hidden>
        <div class="kitchen-board-heading">
          <div><div class="eyebrow dark">Human resources</div><h1>Staff access</h1><p>Confirm employment and assign the role needed for each staff member.</p></div>
        </div>
        <div class="hr-layout">
          <section class="hr-card">
            <h2>Confirm employment &amp; assign role</h2>
            <p>The staff member must first create an account using this email address.</p>
            <form id="hr-assign-form">
              <label class="form-field">Staff account email<input name="email" type="email" autocomplete="off" required maxlength="254" /></label>
              <label class="form-field">Employee number <span class="field-optional">Optional</span><input name="employeeNumber" type="text" maxlength="60" /></label>
              <label class="form-field">Role to assign<select name="role" required>
                <option value="kitchen">Kitchen</option>
                <option value="rider">Rider</option>
                <option value="manager">Manager</option>
                <option value="hr" id="hr-role-option" hidden>HR (owner only)</option>
              </select></label>
              <button class="btn account-submit" id="hr-assign-submit" type="submit">Confirm employment &amp; assign</button>
            </form>
            <p class="kitchen-message" id="hr-assign-message" role="status" aria-live="polite"></p>
            <p class="hr-policy">HR can grant kitchen, rider, and manager roles. Only an owner can grant the HR role. Owner access is managed through the trusted owner process.</p>
          </section>
          <section class="hr-card hr-directory-card">
            <div class="hr-directory-heading"><div><h2>Staff directory</h2><p>Only employment records are shown here.</p></div></div>
            <p class="kitchen-message" id="hr-directory-message" role="status" aria-live="polite"></p>
            <div class="hr-directory" id="hr-directory"></div>
          </section>
        </div>
      </section>
    </main>
  </div>
`,rt=window.location.pathname.replace(/\/+$/,"")==="/kitchen",ct=window.location.pathname.replace(/\/+$/,"")==="/hr";ot.innerHTML=rt?Nt:ct?zt:Pt;if(rt)Tt(ae);else if(ct)Ot(ae);else{let o=function(c,h="info"){E.textContent=c,E.dataset.kind=h},r=function(c){N=c,document.querySelectorAll("#account-tabs [data-mode]").forEach(h=>{const k=h.dataset.mode===c;h.setAttribute("aria-selected",String(k))}),A.dataset.mode=c,M.classList.toggle("is-open",c==="signup"),P.textContent=c==="signup"?"Create an Ivy account to save your details for faster ordering.":"Sign in to your Ivy account or create one to get started.",M.querySelector("input")?.toggleAttribute("required",c==="signup"),document.querySelector("#forgot-password").hidden=c==="signup",b.querySelector('[name="password"]')?.setAttribute("autocomplete",c==="signup"?"new-password":"current-password"),document.querySelector("#auth-submit").textContent=c==="signup"?"Create account":"Sign in",o("")},p=function(){y.open||(y.showModal(),b.hidden||b.querySelector('[name="email"]')?.focus())},i=function(c){F=c,T.textContent=c?c.split(/\s+/)[0]:R.matches?"Account":"My account"},l=function(){I+=1,A.hidden=!1,b.hidden=!1,L.hidden=!0,i(null),P.textContent=N==="signup"?"Create an Ivy account to save your details for faster ordering.":"Sign in to your Ivy account or create one to get started."};It(),Mt(ae,p);const y=document.querySelector("#account-dialog"),b=document.querySelector("#auth-form"),E=document.querySelector("#auth-message"),A=document.querySelector("#account-tabs"),M=document.querySelector("#name-field"),P=document.querySelector("#account-intro"),T=document.querySelector("#account-open"),L=document.querySelector("#profile-card"),$=document.querySelector("#auth-config-note");let N="signin",I=0,F=null;const R=window.matchMedia("(max-width: 759px)");R.addEventListener("change",()=>i(F)),i(null);async function W(c){const h=await fetch(X("/api/me"),{credentials:"include"});if(!h.ok)throw h.status===403?new Error("Your account profile is still being prepared. Please try again shortly."):h.status===401?new Error("Your session expired. Please sign in again."):new Error("We could not load your account. Please try again.");return h.json()}async function H(c){const h=++I;A.hidden=!0,b.hidden=!0,L.hidden=!1,P.textContent="You are signed in to your Ivy account.",o("Loading your account…");try{const k=await W(c);if(h!==I||(document.querySelector("#profile-name").textContent=k.displayName,document.querySelector("#profile-email").textContent=k.email??"",document.querySelector("#profile-roles").textContent=k.roles.join(" · ")||"Customer",document.querySelector("#profile-initial").textContent=k.displayName.charAt(0).toUpperCase(),i(k.displayName),await O(),h!==I))return;o("You’re signed in.","ok")}catch(k){if(h!==I)return;o(k instanceof Error?k.message:"We could not load your account.","error")}}async function O(){const c=await fetch(X("/api/customer/dashboard"),{credentials:"include"});if(!c.ok)throw new Error("We could not load your order history. Please try again.");const h=await c.json();document.querySelector("#dashboard-order-count").textContent=String(h.orderCount),document.querySelector("#dashboard-active-count").textContent=String(h.activeOrderCount);const k=document.querySelector("#dashboard-orders");if(k.replaceChildren(),!h.orders.length){const n=document.createElement("p");n.textContent="Your first order will appear here. Browse the menu to get started.",k.append(n)}for(const n of h.orders){const d=document.createElement("article");d.className="dashboard-order";const m=document.createElement("div");m.className="dashboard-order-heading";const S=document.createElement("strong");S.textContent=n.orderNumber;const q=document.createElement("span");q.textContent=n.fulfillmentStatus.replaceAll("_"," "),m.append(S,q);const z=document.createElement("p");z.textContent=`${n.items.map(_=>`${_.quantity}× ${_.name}`).join(", ")} · ${new Intl.NumberFormat("en-NG",{style:"currency",currency:n.currency,maximumFractionDigits:0}).format(n.totalMinor/100)}`;const D=document.createElement("small");D.textContent=new Date(n.createdAt).toLocaleDateString("en-NG",{day:"numeric",month:"short",year:"numeric"}),d.append(m,z,D),k.append(d)}const a=document.querySelector("#dashboard-picks");a.replaceChildren();for(const n of h.recommendations){const d=document.createElement("div");d.className="dashboard-pick";const m=document.createElement("div"),S=document.createElement("strong");S.textContent=n.name;const q=document.createElement("small");q.textContent=new Intl.NumberFormat("en-NG",{style:"currency",currency:n.currency,maximumFractionDigits:0}).format(n.priceMinor/100),m.append(S,q);const z=document.createElement("button");z.type="button",z.textContent="See menu",z.addEventListener("click",()=>{y.close(),document.querySelector('#menu-filters [data-category="All"]')?.click(),document.querySelector(`[data-card-id="${CSS.escape(n.id)}"]`)?.scrollIntoView({behavior:"smooth",block:"center"})}),d.append(m,z),a.append(d)}}document.querySelector("#account-open").addEventListener("click",p),document.querySelector("#account-close").addEventListener("click",()=>y.close()),y.addEventListener("click",c=>{c.target===y&&y.close()}),document.querySelectorAll("#account-tabs [data-mode]").forEach(c=>{c.addEventListener("click",()=>r(c.dataset.mode==="signup"?"signup":"signin"))}),document.querySelector("#forgot-password").addEventListener("click",async()=>{const c=b.querySelector('[name="email"]').value.trim();if(!c){o("Enter your email address first, and we’ll send a reset link if an account exists."),b.querySelector('[name="email"]').focus();return}o("Sending a password reset link…");const{error:h}=await Re.auth.resetPasswordForEmail(c,`${window.location.origin}/`);o(h?"We could not send a reset link. Please try again later.":"If an account exists for this email, a password reset link is on its way.",h?"error":"ok")}),ae?(b.addEventListener("submit",async c=>{c.preventDefault();const h=new FormData(b),k=String(h.get("email")??"").trim(),a=String(h.get("password")??""),n=document.querySelector("#auth-submit");n.disabled=!0,o(N==="signup"?"Creating your account…":"Signing in…");try{if(N==="signup"){const d=String(h.get("display_name")??"").trim(),{data:m,error:S}=await ae.auth.signUp({email:k,password:a,options:{data:{display_name:d},emailRedirectTo:`${window.location.origin}/`}});if(S)throw S;m.session?await H(m.session):o("Account created. Check your email to confirm it, then sign in here.","ok")}else{const{data:d,error:m}=await ae.auth.signInWithPassword({email:k,password:a});if(m)throw m;if(!d.session)throw new Error("Your email address must be confirmed before you can sign in.");await H(d.session)}}catch(d){const m=d instanceof Error?d.message:"We could not complete that request.";o(/verif|confirm/i.test(m)?"Please confirm your email first. We sent another confirmation link if the account is still unverified.":m,"error")}finally{n.disabled=!1}}),document.querySelector("#sign-out").addEventListener("click",async()=>{const{error:c}=await ae.auth.signOut();if(c){o("We could not sign you out. Please try again.","error");return}l(),r("signin"),o("You’re signed out.","ok")}),ae.auth.getSession().then(({data:c,error:h})=>{if(h){l(),o("We could not restore your session. Please sign in again.","error");return}c.session&&H(c.session)}),ae.auth.onAuthStateChange((c,h)=>{h?H(h):l()})):($.hidden=!1,b.querySelectorAll("input, button").forEach(c=>{c.disabled=!0}),A.querySelectorAll("button").forEach(c=>c.disabled=!0));const x=new URLSearchParams(window.location.search).get("resetToken");if(x){const c=document.querySelector("#password-reset-form");A.hidden=!0,b.hidden=!0,L.hidden=!0,c.hidden=!1,P.textContent="Choose a new password for your Ivy account.",y.showModal(),c.addEventListener("submit",async h=>{h.preventDefault();const k=c.querySelector("button[type=submit]");k.disabled=!0;const a=String(new FormData(c).get("newPassword")??""),{error:n}=await Re.auth.resetPassword(x,a);if(n){o("This password reset link is invalid or expired. Request a new one from sign in.","error"),k.disabled=!1;return}window.history.replaceState({},"",window.location.pathname),c.hidden=!0,b.hidden=!1,A.hidden=!1,r("signin"),o("Your password has been updated. Sign in with your new password.","ok"),k.disabled=!1})}r("signin")}function Tt(o){const r=document.querySelector("#kitchen-login"),p=document.querySelector("#kitchen-login-form"),i=document.querySelector("#kitchen-login-message"),l=document.querySelector("#kitchen-config-note"),y=document.querySelector("#kitchen-denied"),b=document.querySelector("#kitchen-board"),E=document.querySelector("#kitchen-queue-message"),A=document.querySelector("#kitchen-order-grid"),M=document.querySelector("#kitchen-refresh"),P=document.querySelector("#kitchen-sign-out"),T=document.querySelector("#kitchen-staff-name");let L=null,$,N=0;function I(a=""){N+=1,L=null,r.hidden=!1,y.hidden=!0,b.hidden=!0,M.hidden=!0,P.hidden=!0,T.textContent="",i.textContent=a}function F(){A.replaceChildren()}function R(a){if(typeof a=="string")return a;if(typeof a!="object"||a===null||Array.isArray(a))return"Menu item";const n=a;for(const d of["name","item_name","title"])if(typeof n[d]=="string"&&n[d])return n[d];return"Menu item"}function W(a){if(A.replaceChildren(),a.length===0){const n=document.createElement("div");n.className="kitchen-empty",n.innerHTML='<div class="kitchen-empty-mark">✓</div><h2>All caught up</h2><p>New accepted orders will appear here.</p>',A.append(n);return}for(const n of a){const d=document.createElement("article");d.className="kitchen-order-card";const m=document.createElement("div");m.className="kitchen-order-top";const S=document.createElement("h2");S.textContent=n.order_number;const q=document.createElement("span");q.className=`kitchen-status status-${n.fulfillment_status}`,q.textContent=n.fulfillment_status.replaceAll("_"," "),m.append(S,q),d.append(m);const z=document.createElement("p");z.className="kitchen-order-time";const D=new Date(n.created_at);z.textContent=Number.isNaN(D.getTime())?"Order time unavailable":`Placed ${D.toLocaleTimeString("en-NG",{hour:"numeric",minute:"2-digit"})}`,d.append(z);const _=document.createElement("ul");_.className="kitchen-items";for(const B of n.items){const ce=document.createElement("li"),ee=document.createElement("span");ee.className="kitchen-item-quantity",ee.textContent=`${B.quantity}×`;const te=document.createElement("span");te.textContent=R(B.item),ce.append(ee,te),_.append(ce)}if(d.append(_),n.fulfillment_status!=="ready_for_delivery"){const B=document.createElement("button");B.type="button",B.className="btn kitchen-order-action",B.textContent=n.fulfillment_status==="accepted"?"Start preparing":"Mark ready",B.addEventListener("click",()=>{x(n,B)}),d.append(B)}A.append(d)}}async function H(a,n={}){if(!L)throw new Error("Your session has ended. Please sign in again.");const d=new Headers(n.headers);return n.body&&d.set("Content-Type","application/json"),fetch(X(a),{...n,headers:d,credentials:"include"})}async function O(a=!1){if(L){a||(M.disabled=!0,E.textContent="Refreshing orders…");try{const n=await H("/api/kitchen/orders");if(!n.ok)throw n.status===401?new Error("Your session expired. Sign in again to continue."):new Error("Could not load orders. Try refreshing the queue.");const d=await n.json();W(d.orders),E.textContent=`Updated ${new Date().toLocaleTimeString("en-NG",{hour:"numeric",minute:"2-digit"})}`}catch(n){E.textContent=n instanceof Error?n.message:"Could not load orders."}finally{M.disabled=!1}}}async function x(a,n){n.disabled=!0,n.textContent="Saving…";const d=a.fulfillment_status==="accepted"?"preparing":"ready_for_delivery";try{const m=await H(`/api/kitchen/orders/${encodeURIComponent(a.id)}/status`,{method:"PATCH",body:JSON.stringify({status:d})});if(!m.ok){const S=await m.json().catch(()=>({}));throw new Error(S.error??"Could not update this order.")}E.textContent=`${a.order_number} moved to ${d.replaceAll("_"," ")}.`,await O(!0)}catch(m){E.textContent=m instanceof Error?m.message:"Could not update this order.",n.disabled=!1,n.textContent=a.fulfillment_status==="accepted"?"Start preparing":"Mark ready"}}async function c(a){const n=++N;L=a,i.textContent="Checking staff access…";try{const d=await H("/api/me");if(!d.ok)throw d.status===401?new Error("Your session expired. Please sign in again."):new Error("Could not verify this account. Please try again.");const m=await d.json();if(n!==N)return;if(!m.roles.some(q=>["kitchen","manager","owner"].includes(q))){r.hidden=!0,y.hidden=!1,b.hidden=!0,M.hidden=!0,P.hidden=!1,T.textContent=m.displayName;return}r.hidden=!0,y.hidden=!0,b.hidden=!1,M.hidden=!1,P.hidden=!1,T.textContent=m.displayName,await O(),$&&window.clearInterval($),$=window.setInterval(()=>{O(!0)},15e3)}catch(d){if(n!==N)return;I(d instanceof Error?d.message:"Could not sign in.")}}if(!o){l.hidden=!1,p.querySelectorAll("input, button").forEach(a=>{a.disabled=!0});return}const h=o;p.addEventListener("submit",async a=>{a.preventDefault();const n=document.querySelector("#kitchen-login-submit");n.disabled=!0,i.textContent="Signing in…";const d=new FormData(p);try{const{data:m,error:S}=await h.auth.signInWithPassword({email:String(d.get("email")??"").trim(),password:String(d.get("password")??"")});if(S)throw S;if(!m.session)throw new Error("Your email address must be confirmed before you can sign in.");await c(m.session)}catch(m){i.textContent=m instanceof Error?m.message:"Could not sign in."}finally{n.disabled=!1}});async function k(){$&&window.clearInterval($),$=void 0;const{error:a}=await h.auth.signOut();if(a){E.textContent="Could not sign out. Please try again.";return}F(),I()}M.addEventListener("click",()=>{O()}),P.addEventListener("click",()=>{k()}),document.querySelector("#kitchen-denied-sign-out").addEventListener("click",()=>{k()}),h.auth.getSession().then(({data:a,error:n})=>{n?I("Could not restore your session. Please sign in again."):a.session&&c(a.session)}),h.auth.onAuthStateChange((a,n)=>{n?L=n:($&&window.clearInterval($),$=void 0,F(),I())})}function Ot(o){const r=document.querySelector("#hr-login"),p=document.querySelector("#hr-login-form"),i=document.querySelector("#hr-login-message"),l=document.querySelector("#hr-config-note"),y=document.querySelector("#hr-denied"),b=document.querySelector("#hr-board"),E=document.querySelector("#hr-staff-name"),A=document.querySelector("#hr-sign-out"),M=document.querySelector("#hr-refresh"),P=document.querySelector("#hr-assign-form"),T=document.querySelector("#hr-assign-message"),L=document.querySelector("#hr-directory-message"),$=document.querySelector("#hr-directory"),N=document.querySelector("#hr-role-option");let I=null,F=0;function R(a=""){F+=1,I=null,r.hidden=!1,y.hidden=!0,b.hidden=!0,A.hidden=!0,M.hidden=!0,E.textContent="",i.textContent=a}async function W(a,n={}){if(!I)throw new Error("Your session has ended. Please sign in again.");const d=new Headers(n.headers);return n.body&&d.set("Content-Type","application/json"),fetch(X(a),{...n,headers:d})}function H(a){if($.replaceChildren(),a.length===0){const q=document.createElement("p");q.className="hr-empty",q.textContent="No staff records yet. Confirm employment and assign a role to add the first staff member.",$.append(q);return}const n=document.createElement("table");n.className="hr-table";const d=document.createElement("thead");d.innerHTML="<tr><th>Staff member</th><th>Role</th><th>Employment</th><th></th></tr>";const m=document.createElement("tbody");for(const q of a){const z=document.createElement("tr"),D=document.createElement("td"),_=document.createElement("strong");_.textContent=q.displayName;const B=document.createElement("span");B.textContent=q.email??"No email on file",D.append(_,B);const ce=document.createElement("td");ce.textContent=q.roles.length?q.roles.map(J=>J.replaceAll("_"," ")).join(", "):"No role";const ee=document.createElement("td"),te=document.createElement("span");te.className=`employment-badge ${q.employmentStatus}`,te.textContent=q.employmentStatus,ee.append(te);const ke=document.createElement("td");if(q.employmentStatus==="employed"){const J=document.createElement("button");J.type="button",J.className="hr-offboard",J.textContent="End employment",J.addEventListener("click",()=>{x(q,J)}),ke.append(J)}z.append(D,ce,ee,ke),m.append(z)}n.append(d,m);const S=document.createElement("div");S.className="hr-table-scroll",S.append(n),$.append(S)}async function O(){L.textContent="Loading staff records…";try{const a=await W("/api/hr/staff"),n=await a.json().catch(()=>({}));if(!a.ok)throw new Error(n.error??"Could not load staff records.");H(n.staff??[]),L.textContent=`${n.staff?.length??0} staff record${n.staff?.length===1?"":"s"}`}catch(a){L.textContent=a instanceof Error?a.message:"Could not load staff records."}}async function x(a,n){if(window.confirm(`End employment for ${a.displayName}? Their kitchen, manager, rider, and HR roles will be removed.`)){n.disabled=!0,n.textContent="Updating…";try{const d=await W(`/api/hr/staff/${encodeURIComponent(a.id)}/offboard`,{method:"PATCH"}),m=await d.json().catch(()=>({}));if(!d.ok)throw new Error(m.error??"Could not update employment status.");L.textContent=`${a.displayName} was offboarded and staff roles were removed.`,await O()}catch(d){L.textContent=d instanceof Error?d.message:"Could not update employment status.",n.disabled=!1,n.textContent="End employment"}}}async function c(a){const n=++F;I=a,i.textContent="Checking HR access…";try{const d=await W("/api/me");if(!d.ok)throw new Error(d.status===401?"Your session expired. Please sign in again.":"Could not verify this account.");const m=await d.json();if(n!==F)return;if(!m.roles.some(q=>["hr","owner"].includes(q))){r.hidden=!0,y.hidden=!1,b.hidden=!0,A.hidden=!1,E.textContent=m.displayName;return}r.hidden=!0,y.hidden=!0,b.hidden=!1,A.hidden=!1,M.hidden=!1,N.hidden=!m.roles.includes("owner"),E.textContent=m.displayName,await O()}catch(d){if(n!==F)return;R(d instanceof Error?d.message:"Could not sign in.")}}if(!o){l.hidden=!1,p.querySelectorAll("input, button").forEach(a=>{a.disabled=!0});return}const h=o;p.addEventListener("submit",async a=>{a.preventDefault();const n=document.querySelector("#hr-login-submit");n.disabled=!0,i.textContent="Signing in…";const d=new FormData(p);try{const{data:m,error:S}=await h.auth.signInWithPassword({email:String(d.get("email")??"").trim(),password:String(d.get("password")??"")});if(S)throw S;if(!m.session)throw new Error("Your email address must be confirmed before you can sign in.");await c(m.session)}catch(m){i.textContent=m instanceof Error?m.message:"Could not sign in."}finally{n.disabled=!1}}),P.addEventListener("submit",async a=>{a.preventDefault();const n=document.querySelector("#hr-assign-submit");n.disabled=!0,T.textContent="Confirming employment and assigning role…";const d=new FormData(P);try{const m=await W("/api/hr/staff/assign",{method:"POST",body:JSON.stringify({email:String(d.get("email")??"").trim(),employeeNumber:String(d.get("employeeNumber")??"").trim(),role:String(d.get("role")??"")})}),S=await m.json().catch(()=>({}));if(!m.ok)throw new Error(S.error??"Could not assign that role.");P.reset(),T.textContent=S.message??"Staff role assigned.",await O()}catch(m){T.textContent=m instanceof Error?m.message:"Could not assign that role."}finally{n.disabled=!1}});async function k(){const{error:a}=await h.auth.signOut();if(a){L.textContent="Could not sign out. Please try again.";return}R()}M.addEventListener("click",()=>{O()}),A.addEventListener("click",()=>{k()}),document.querySelector("#hr-denied-sign-out").addEventListener("click",()=>{k()}),h.auth.getSession().then(({data:a,error:n})=>{n?R("Could not restore your session. Please sign in again."):a.session&&c(a.session)}),h.auth.onAuthStateChange((a,n)=>{n?I=n:R()})}
