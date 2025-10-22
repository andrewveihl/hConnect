import{aQ as Nd}from"./fyz5Uh2_.js";const ME=Nd(null),Nt=globalThis.__sveltekit_xg75g0.env;/**
 * @license
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Od=()=>{};var Xa={};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Su=function(n){const e=[];let t=0;for(let r=0;r<n.length;r++){let s=n.charCodeAt(r);s<128?e[t++]=s:s<2048?(e[t++]=s>>6|192,e[t++]=s&63|128):(s&64512)===55296&&r+1<n.length&&(n.charCodeAt(r+1)&64512)===56320?(s=65536+((s&1023)<<10)+(n.charCodeAt(++r)&1023),e[t++]=s>>18|240,e[t++]=s>>12&63|128,e[t++]=s>>6&63|128,e[t++]=s&63|128):(e[t++]=s>>12|224,e[t++]=s>>6&63|128,e[t++]=s&63|128)}return e},Md=function(n){const e=[];let t=0,r=0;for(;t<n.length;){const s=n[t++];if(s<128)e[r++]=String.fromCharCode(s);else if(s>191&&s<224){const o=n[t++];e[r++]=String.fromCharCode((s&31)<<6|o&63)}else if(s>239&&s<365){const o=n[t++],a=n[t++],u=n[t++],h=((s&7)<<18|(o&63)<<12|(a&63)<<6|u&63)-65536;e[r++]=String.fromCharCode(55296+(h>>10)),e[r++]=String.fromCharCode(56320+(h&1023))}else{const o=n[t++],a=n[t++];e[r++]=String.fromCharCode((s&15)<<12|(o&63)<<6|a&63)}}return e.join("")},Pu={byteToCharMap_:null,charToByteMap_:null,byteToCharMapWebSafe_:null,charToByteMapWebSafe_:null,ENCODED_VALS_BASE:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",get ENCODED_VALS(){return this.ENCODED_VALS_BASE+"+/="},get ENCODED_VALS_WEBSAFE(){return this.ENCODED_VALS_BASE+"-_."},HAS_NATIVE_SUPPORT:typeof atob=="function",encodeByteArray(n,e){if(!Array.isArray(n))throw Error("encodeByteArray takes an array as a parameter");this.init_();const t=e?this.byteToCharMapWebSafe_:this.byteToCharMap_,r=[];for(let s=0;s<n.length;s+=3){const o=n[s],a=s+1<n.length,u=a?n[s+1]:0,h=s+2<n.length,d=h?n[s+2]:0,p=o>>2,y=(o&3)<<4|u>>4;let E=(u&15)<<2|d>>6,C=d&63;h||(C=64,a||(E=64)),r.push(t[p],t[y],t[E],t[C])}return r.join("")},encodeString(n,e){return this.HAS_NATIVE_SUPPORT&&!e?btoa(n):this.encodeByteArray(Su(n),e)},decodeString(n,e){return this.HAS_NATIVE_SUPPORT&&!e?atob(n):Md(this.decodeStringToByteArray(n,e))},decodeStringToByteArray(n,e){this.init_();const t=e?this.charToByteMapWebSafe_:this.charToByteMap_,r=[];for(let s=0;s<n.length;){const o=t[n.charAt(s++)],u=s<n.length?t[n.charAt(s)]:0;++s;const d=s<n.length?t[n.charAt(s)]:64;++s;const y=s<n.length?t[n.charAt(s)]:64;if(++s,o==null||u==null||d==null||y==null)throw new Ld;const E=o<<2|u>>4;if(r.push(E),d!==64){const C=u<<4&240|d>>2;if(r.push(C),y!==64){const b=d<<6&192|y;r.push(b)}}}return r},init_(){if(!this.byteToCharMap_){this.byteToCharMap_={},this.charToByteMap_={},this.byteToCharMapWebSafe_={},this.charToByteMapWebSafe_={};for(let n=0;n<this.ENCODED_VALS.length;n++)this.byteToCharMap_[n]=this.ENCODED_VALS.charAt(n),this.charToByteMap_[this.byteToCharMap_[n]]=n,this.byteToCharMapWebSafe_[n]=this.ENCODED_VALS_WEBSAFE.charAt(n),this.charToByteMapWebSafe_[this.byteToCharMapWebSafe_[n]]=n,n>=this.ENCODED_VALS_BASE.length&&(this.charToByteMap_[this.ENCODED_VALS_WEBSAFE.charAt(n)]=n,this.charToByteMapWebSafe_[this.ENCODED_VALS.charAt(n)]=n)}}};class Ld extends Error{constructor(){super(...arguments),this.name="DecodeBase64StringError"}}const xd=function(n){const e=Su(n);return Pu.encodeByteArray(e,!0)},ts=function(n){return xd(n).replace(/\./g,"")},Cu=function(n){try{return Pu.decodeString(n,!0)}catch(e){console.error("base64Decode failed: ",e)}return null};/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Fd(){if(typeof self<"u")return self;if(typeof window<"u")return window;if(typeof global<"u")return global;throw new Error("Unable to locate global object.")}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Ud=()=>Fd().__FIREBASE_DEFAULTS__,Bd=()=>{if(typeof process>"u"||typeof Xa>"u")return;const n=Xa.__FIREBASE_DEFAULTS__;if(n)return JSON.parse(n)},jd=()=>{if(typeof document>"u")return;let n;try{n=document.cookie.match(/__FIREBASE_DEFAULTS__=([^;]+)/)}catch{return}const e=n&&Cu(n[1]);return e&&JSON.parse(e)},Es=()=>{try{return Od()||Ud()||Bd()||jd()}catch(n){console.info(`Unable to get __FIREBASE_DEFAULTS__ due to: ${n}`);return}},bu=n=>Es()?.emulatorHosts?.[n],qd=n=>{const e=bu(n);if(!e)return;const t=e.lastIndexOf(":");if(t<=0||t+1===e.length)throw new Error(`Invalid host ${e} with no separate hostname and port!`);const r=parseInt(e.substring(t+1),10);return e[0]==="["?[e.substring(1,t-1),r]:[e.substring(0,t),r]},Vu=()=>Es()?.config,ku=n=>Es()?.[`_${n}`];/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class $d{constructor(){this.reject=()=>{},this.resolve=()=>{},this.promise=new Promise((e,t)=>{this.resolve=e,this.reject=t})}wrapCallback(e){return(t,r)=>{t?this.reject(t):this.resolve(r),typeof e=="function"&&(this.promise.catch(()=>{}),e.length===1?e(t):e(t,r))}}}/**
 * @license
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function fn(n){try{return(n.startsWith("http://")||n.startsWith("https://")?new URL(n).hostname:n).endsWith(".cloudworkstations.dev")}catch{return!1}}async function Du(n){return(await fetch(n,{credentials:"include"})).ok}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function zd(n,e){if(n.uid)throw new Error('The "uid" field is no longer supported by mockUserToken. Please use "sub" instead for Firebase Auth User ID.');const t={alg:"none",type:"JWT"},r=e||"demo-project",s=n.iat||0,o=n.sub||n.user_id;if(!o)throw new Error("mockUserToken must contain 'sub' or 'user_id' field!");const a={iss:`https://securetoken.google.com/${r}`,aud:r,iat:s,exp:s+3600,auth_time:s,sub:o,user_id:o,firebase:{sign_in_provider:"custom",identities:{}},...n};return[ts(JSON.stringify(t)),ts(JSON.stringify(a)),""].join(".")}const $n={};function Hd(){const n={prod:[],emulator:[]};for(const e of Object.keys($n))$n[e]?n.emulator.push(e):n.prod.push(e);return n}function Gd(n){let e=document.getElementById(n),t=!1;return e||(e=document.createElement("div"),e.setAttribute("id",n),t=!0),{created:t,element:e}}let Ya=!1;function Nu(n,e){if(typeof window>"u"||typeof document>"u"||!fn(window.location.host)||$n[n]===e||$n[n]||Ya)return;$n[n]=e;function t(E){return`__firebase__banner__${E}`}const r="__firebase__banner",o=Hd().prod.length>0;function a(){const E=document.getElementById(r);E&&E.remove()}function u(E){E.style.display="flex",E.style.background="#7faaf0",E.style.position="fixed",E.style.bottom="5px",E.style.left="5px",E.style.padding=".5em",E.style.borderRadius="5px",E.style.alignItems="center"}function h(E,C){E.setAttribute("width","24"),E.setAttribute("id",C),E.setAttribute("height","24"),E.setAttribute("viewBox","0 0 24 24"),E.setAttribute("fill","none"),E.style.marginLeft="-6px"}function d(){const E=document.createElement("span");return E.style.cursor="pointer",E.style.marginLeft="16px",E.style.fontSize="24px",E.innerHTML=" &times;",E.onclick=()=>{Ya=!0,a()},E}function p(E,C){E.setAttribute("id",C),E.innerText="Learn more",E.href="https://firebase.google.com/docs/studio/preview-apps#preview-backend",E.setAttribute("target","__blank"),E.style.paddingLeft="5px",E.style.textDecoration="underline"}function y(){const E=Gd(r),C=t("text"),b=document.getElementById(C)||document.createElement("span"),O=t("learnmore"),k=document.getElementById(O)||document.createElement("a"),z=t("preprendIcon"),B=document.getElementById(z)||document.createElementNS("http://www.w3.org/2000/svg","svg");if(E.created){const H=E.element;u(H),p(k,O);const ue=d();h(B,z),H.append(B,b,k,ue),document.body.appendChild(H)}o?(b.innerText="Preview backend disconnected.",B.innerHTML=`<g clip-path="url(#clip0_6013_33858)">
<path d="M4.8 17.6L12 5.6L19.2 17.6H4.8ZM6.91667 16.4H17.0833L12 7.93333L6.91667 16.4ZM12 15.6C12.1667 15.6 12.3056 15.5444 12.4167 15.4333C12.5389 15.3111 12.6 15.1667 12.6 15C12.6 14.8333 12.5389 14.6944 12.4167 14.5833C12.3056 14.4611 12.1667 14.4 12 14.4C11.8333 14.4 11.6889 14.4611 11.5667 14.5833C11.4556 14.6944 11.4 14.8333 11.4 15C11.4 15.1667 11.4556 15.3111 11.5667 15.4333C11.6889 15.5444 11.8333 15.6 12 15.6ZM11.4 13.6H12.6V10.4H11.4V13.6Z" fill="#212121"/>
</g>
<defs>
<clipPath id="clip0_6013_33858">
<rect width="24" height="24" fill="white"/>
</clipPath>
</defs>`):(B.innerHTML=`<g clip-path="url(#clip0_6083_34804)">
<path d="M11.4 15.2H12.6V11.2H11.4V15.2ZM12 10C12.1667 10 12.3056 9.94444 12.4167 9.83333C12.5389 9.71111 12.6 9.56667 12.6 9.4C12.6 9.23333 12.5389 9.09444 12.4167 8.98333C12.3056 8.86111 12.1667 8.8 12 8.8C11.8333 8.8 11.6889 8.86111 11.5667 8.98333C11.4556 9.09444 11.4 9.23333 11.4 9.4C11.4 9.56667 11.4556 9.71111 11.5667 9.83333C11.6889 9.94444 11.8333 10 12 10ZM12 18.4C11.1222 18.4 10.2944 18.2333 9.51667 17.9C8.73889 17.5667 8.05556 17.1111 7.46667 16.5333C6.88889 15.9444 6.43333 15.2611 6.1 14.4833C5.76667 13.7056 5.6 12.8778 5.6 12C5.6 11.1111 5.76667 10.2833 6.1 9.51667C6.43333 8.73889 6.88889 8.06111 7.46667 7.48333C8.05556 6.89444 8.73889 6.43333 9.51667 6.1C10.2944 5.76667 11.1222 5.6 12 5.6C12.8889 5.6 13.7167 5.76667 14.4833 6.1C15.2611 6.43333 15.9389 6.89444 16.5167 7.48333C17.1056 8.06111 17.5667 8.73889 17.9 9.51667C18.2333 10.2833 18.4 11.1111 18.4 12C18.4 12.8778 18.2333 13.7056 17.9 14.4833C17.5667 15.2611 17.1056 15.9444 16.5167 16.5333C15.9389 17.1111 15.2611 17.5667 14.4833 17.9C13.7167 18.2333 12.8889 18.4 12 18.4ZM12 17.2C13.4444 17.2 14.6722 16.6944 15.6833 15.6833C16.6944 14.6722 17.2 13.4444 17.2 12C17.2 10.5556 16.6944 9.32778 15.6833 8.31667C14.6722 7.30555 13.4444 6.8 12 6.8C10.5556 6.8 9.32778 7.30555 8.31667 8.31667C7.30556 9.32778 6.8 10.5556 6.8 12C6.8 13.4444 7.30556 14.6722 8.31667 15.6833C9.32778 16.6944 10.5556 17.2 12 17.2Z" fill="#212121"/>
</g>
<defs>
<clipPath id="clip0_6083_34804">
<rect width="24" height="24" fill="white"/>
</clipPath>
</defs>`,b.innerText="Preview backend running in this workspace."),b.setAttribute("id",C)}document.readyState==="loading"?window.addEventListener("DOMContentLoaded",y):y()}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function ve(){return typeof navigator<"u"&&typeof navigator.userAgent=="string"?navigator.userAgent:""}function Wd(){return typeof window<"u"&&!!(window.cordova||window.phonegap||window.PhoneGap)&&/ios|iphone|ipod|ipad|android|blackberry|iemobile/i.test(ve())}function Kd(){const n=Es()?.forceEnvironment;if(n==="node")return!0;if(n==="browser")return!1;try{return Object.prototype.toString.call(global.process)==="[object process]"}catch{return!1}}function Qd(){return typeof navigator<"u"&&navigator.userAgent==="Cloudflare-Workers"}function Jd(){const n=typeof chrome=="object"?chrome.runtime:typeof browser=="object"?browser.runtime:void 0;return typeof n=="object"&&n.id!==void 0}function Xd(){return typeof navigator=="object"&&navigator.product==="ReactNative"}function Yd(){const n=ve();return n.indexOf("MSIE ")>=0||n.indexOf("Trident/")>=0}function Zd(){return!Kd()&&!!navigator.userAgent&&navigator.userAgent.includes("Safari")&&!navigator.userAgent.includes("Chrome")}function ef(){try{return typeof indexedDB=="object"}catch{return!1}}function tf(){return new Promise((n,e)=>{try{let t=!0;const r="validate-browser-context-for-indexeddb-analytics-module",s=self.indexedDB.open(r);s.onsuccess=()=>{s.result.close(),t||self.indexedDB.deleteDatabase(r),n(!0)},s.onupgradeneeded=()=>{t=!1},s.onerror=()=>{e(s.error?.message||"")}}catch(t){e(t)}})}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const nf="FirebaseError";class it extends Error{constructor(e,t,r){super(t),this.code=e,this.customData=r,this.name=nf,Object.setPrototypeOf(this,it.prototype),Error.captureStackTrace&&Error.captureStackTrace(this,ar.prototype.create)}}class ar{constructor(e,t,r){this.service=e,this.serviceName=t,this.errors=r}create(e,...t){const r=t[0]||{},s=`${this.service}/${e}`,o=this.errors[e],a=o?rf(o,r):"Error",u=`${this.serviceName}: ${a} (${s}).`;return new it(s,u,r)}}function rf(n,e){return n.replace(sf,(t,r)=>{const s=e[r];return s!=null?String(s):`<${r}?>`})}const sf=/\{\$([^}]+)}/g;function of(n){for(const e in n)if(Object.prototype.hasOwnProperty.call(n,e))return!1;return!0}function Bt(n,e){if(n===e)return!0;const t=Object.keys(n),r=Object.keys(e);for(const s of t){if(!r.includes(s))return!1;const o=n[s],a=e[s];if(Za(o)&&Za(a)){if(!Bt(o,a))return!1}else if(o!==a)return!1}for(const s of r)if(!t.includes(s))return!1;return!0}function Za(n){return n!==null&&typeof n=="object"}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function cr(n){const e=[];for(const[t,r]of Object.entries(n))Array.isArray(r)?r.forEach(s=>{e.push(encodeURIComponent(t)+"="+encodeURIComponent(s))}):e.push(encodeURIComponent(t)+"="+encodeURIComponent(r));return e.length?"&"+e.join("&"):""}function af(n,e){const t=new cf(n,e);return t.subscribe.bind(t)}class cf{constructor(e,t){this.observers=[],this.unsubscribes=[],this.observerCount=0,this.task=Promise.resolve(),this.finalized=!1,this.onNoObservers=t,this.task.then(()=>{e(this)}).catch(r=>{this.error(r)})}next(e){this.forEachObserver(t=>{t.next(e)})}error(e){this.forEachObserver(t=>{t.error(e)}),this.close(e)}complete(){this.forEachObserver(e=>{e.complete()}),this.close()}subscribe(e,t,r){let s;if(e===void 0&&t===void 0&&r===void 0)throw new Error("Missing Observer.");uf(e,["next","error","complete"])?s=e:s={next:e,error:t,complete:r},s.next===void 0&&(s.next=mi),s.error===void 0&&(s.error=mi),s.complete===void 0&&(s.complete=mi);const o=this.unsubscribeOne.bind(this,this.observers.length);return this.finalized&&this.task.then(()=>{try{this.finalError?s.error(this.finalError):s.complete()}catch{}}),this.observers.push(s),o}unsubscribeOne(e){this.observers===void 0||this.observers[e]===void 0||(delete this.observers[e],this.observerCount-=1,this.observerCount===0&&this.onNoObservers!==void 0&&this.onNoObservers(this))}forEachObserver(e){if(!this.finalized)for(let t=0;t<this.observers.length;t++)this.sendOne(t,e)}sendOne(e,t){this.task.then(()=>{if(this.observers!==void 0&&this.observers[e]!==void 0)try{t(this.observers[e])}catch(r){typeof console<"u"&&console.error&&console.error(r)}})}close(e){this.finalized||(this.finalized=!0,e!==void 0&&(this.finalError=e),this.task.then(()=>{this.observers=void 0,this.onNoObservers=void 0}))}}function uf(n,e){if(typeof n!="object"||n===null)return!1;for(const t of e)if(t in n&&typeof n[t]=="function")return!0;return!1}function mi(){}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function ce(n){return n&&n._delegate?n._delegate:n}class jt{constructor(e,t,r){this.name=e,this.instanceFactory=t,this.type=r,this.multipleInstances=!1,this.serviceProps={},this.instantiationMode="LAZY",this.onInstanceCreated=null}setInstantiationMode(e){return this.instantiationMode=e,this}setMultipleInstances(e){return this.multipleInstances=e,this}setServiceProps(e){return this.serviceProps=e,this}setInstanceCreatedCallback(e){return this.onInstanceCreated=e,this}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Ot="[DEFAULT]";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class lf{constructor(e,t){this.name=e,this.container=t,this.component=null,this.instances=new Map,this.instancesDeferred=new Map,this.instancesOptions=new Map,this.onInitCallbacks=new Map}get(e){const t=this.normalizeInstanceIdentifier(e);if(!this.instancesDeferred.has(t)){const r=new $d;if(this.instancesDeferred.set(t,r),this.isInitialized(t)||this.shouldAutoInitialize())try{const s=this.getOrInitializeService({instanceIdentifier:t});s&&r.resolve(s)}catch{}}return this.instancesDeferred.get(t).promise}getImmediate(e){const t=this.normalizeInstanceIdentifier(e?.identifier),r=e?.optional??!1;if(this.isInitialized(t)||this.shouldAutoInitialize())try{return this.getOrInitializeService({instanceIdentifier:t})}catch(s){if(r)return null;throw s}else{if(r)return null;throw Error(`Service ${this.name} is not available`)}}getComponent(){return this.component}setComponent(e){if(e.name!==this.name)throw Error(`Mismatching Component ${e.name} for Provider ${this.name}.`);if(this.component)throw Error(`Component for ${this.name} has already been provided`);if(this.component=e,!!this.shouldAutoInitialize()){if(df(e))try{this.getOrInitializeService({instanceIdentifier:Ot})}catch{}for(const[t,r]of this.instancesDeferred.entries()){const s=this.normalizeInstanceIdentifier(t);try{const o=this.getOrInitializeService({instanceIdentifier:s});r.resolve(o)}catch{}}}}clearInstance(e=Ot){this.instancesDeferred.delete(e),this.instancesOptions.delete(e),this.instances.delete(e)}async delete(){const e=Array.from(this.instances.values());await Promise.all([...e.filter(t=>"INTERNAL"in t).map(t=>t.INTERNAL.delete()),...e.filter(t=>"_delete"in t).map(t=>t._delete())])}isComponentSet(){return this.component!=null}isInitialized(e=Ot){return this.instances.has(e)}getOptions(e=Ot){return this.instancesOptions.get(e)||{}}initialize(e={}){const{options:t={}}=e,r=this.normalizeInstanceIdentifier(e.instanceIdentifier);if(this.isInitialized(r))throw Error(`${this.name}(${r}) has already been initialized`);if(!this.isComponentSet())throw Error(`Component ${this.name} has not been registered yet`);const s=this.getOrInitializeService({instanceIdentifier:r,options:t});for(const[o,a]of this.instancesDeferred.entries()){const u=this.normalizeInstanceIdentifier(o);r===u&&a.resolve(s)}return s}onInit(e,t){const r=this.normalizeInstanceIdentifier(t),s=this.onInitCallbacks.get(r)??new Set;s.add(e),this.onInitCallbacks.set(r,s);const o=this.instances.get(r);return o&&e(o,r),()=>{s.delete(e)}}invokeOnInitCallbacks(e,t){const r=this.onInitCallbacks.get(t);if(r)for(const s of r)try{s(e,t)}catch{}}getOrInitializeService({instanceIdentifier:e,options:t={}}){let r=this.instances.get(e);if(!r&&this.component&&(r=this.component.instanceFactory(this.container,{instanceIdentifier:hf(e),options:t}),this.instances.set(e,r),this.instancesOptions.set(e,t),this.invokeOnInitCallbacks(r,e),this.component.onInstanceCreated))try{this.component.onInstanceCreated(this.container,e,r)}catch{}return r||null}normalizeInstanceIdentifier(e=Ot){return this.component?this.component.multipleInstances?e:Ot:e}shouldAutoInitialize(){return!!this.component&&this.component.instantiationMode!=="EXPLICIT"}}function hf(n){return n===Ot?void 0:n}function df(n){return n.instantiationMode==="EAGER"}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ff{constructor(e){this.name=e,this.providers=new Map}addComponent(e){const t=this.getProvider(e.name);if(t.isComponentSet())throw new Error(`Component ${e.name} has already been registered with ${this.name}`);t.setComponent(e)}addOrOverwriteComponent(e){this.getProvider(e.name).isComponentSet()&&this.providers.delete(e.name),this.addComponent(e)}getProvider(e){if(this.providers.has(e))return this.providers.get(e);const t=new lf(e,this);return this.providers.set(e,t),t}getProviders(){return Array.from(this.providers.values())}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */var j;(function(n){n[n.DEBUG=0]="DEBUG",n[n.VERBOSE=1]="VERBOSE",n[n.INFO=2]="INFO",n[n.WARN=3]="WARN",n[n.ERROR=4]="ERROR",n[n.SILENT=5]="SILENT"})(j||(j={}));const pf={debug:j.DEBUG,verbose:j.VERBOSE,info:j.INFO,warn:j.WARN,error:j.ERROR,silent:j.SILENT},mf=j.INFO,gf={[j.DEBUG]:"log",[j.VERBOSE]:"log",[j.INFO]:"info",[j.WARN]:"warn",[j.ERROR]:"error"},_f=(n,e,...t)=>{if(e<n.logLevel)return;const r=new Date().toISOString(),s=gf[e];if(s)console[s](`[${r}]  ${n.name}:`,...t);else throw new Error(`Attempted to log a message with an invalid logType (value: ${e})`)};class eo{constructor(e){this.name=e,this._logLevel=mf,this._logHandler=_f,this._userLogHandler=null}get logLevel(){return this._logLevel}set logLevel(e){if(!(e in j))throw new TypeError(`Invalid value "${e}" assigned to \`logLevel\``);this._logLevel=e}setLogLevel(e){this._logLevel=typeof e=="string"?pf[e]:e}get logHandler(){return this._logHandler}set logHandler(e){if(typeof e!="function")throw new TypeError("Value assigned to `logHandler` must be a function");this._logHandler=e}get userLogHandler(){return this._userLogHandler}set userLogHandler(e){this._userLogHandler=e}debug(...e){this._userLogHandler&&this._userLogHandler(this,j.DEBUG,...e),this._logHandler(this,j.DEBUG,...e)}log(...e){this._userLogHandler&&this._userLogHandler(this,j.VERBOSE,...e),this._logHandler(this,j.VERBOSE,...e)}info(...e){this._userLogHandler&&this._userLogHandler(this,j.INFO,...e),this._logHandler(this,j.INFO,...e)}warn(...e){this._userLogHandler&&this._userLogHandler(this,j.WARN,...e),this._logHandler(this,j.WARN,...e)}error(...e){this._userLogHandler&&this._userLogHandler(this,j.ERROR,...e),this._logHandler(this,j.ERROR,...e)}}const yf=(n,e)=>e.some(t=>n instanceof t);let ec,tc;function Ef(){return ec||(ec=[IDBDatabase,IDBObjectStore,IDBIndex,IDBCursor,IDBTransaction])}function Tf(){return tc||(tc=[IDBCursor.prototype.advance,IDBCursor.prototype.continue,IDBCursor.prototype.continuePrimaryKey])}const Ou=new WeakMap,Ci=new WeakMap,Mu=new WeakMap,gi=new WeakMap,to=new WeakMap;function If(n){const e=new Promise((t,r)=>{const s=()=>{n.removeEventListener("success",o),n.removeEventListener("error",a)},o=()=>{t(mt(n.result)),s()},a=()=>{r(n.error),s()};n.addEventListener("success",o),n.addEventListener("error",a)});return e.then(t=>{t instanceof IDBCursor&&Ou.set(t,n)}).catch(()=>{}),to.set(e,n),e}function vf(n){if(Ci.has(n))return;const e=new Promise((t,r)=>{const s=()=>{n.removeEventListener("complete",o),n.removeEventListener("error",a),n.removeEventListener("abort",a)},o=()=>{t(),s()},a=()=>{r(n.error||new DOMException("AbortError","AbortError")),s()};n.addEventListener("complete",o),n.addEventListener("error",a),n.addEventListener("abort",a)});Ci.set(n,e)}let bi={get(n,e,t){if(n instanceof IDBTransaction){if(e==="done")return Ci.get(n);if(e==="objectStoreNames")return n.objectStoreNames||Mu.get(n);if(e==="store")return t.objectStoreNames[1]?void 0:t.objectStore(t.objectStoreNames[0])}return mt(n[e])},set(n,e,t){return n[e]=t,!0},has(n,e){return n instanceof IDBTransaction&&(e==="done"||e==="store")?!0:e in n}};function wf(n){bi=n(bi)}function Af(n){return n===IDBDatabase.prototype.transaction&&!("objectStoreNames"in IDBTransaction.prototype)?function(e,...t){const r=n.call(_i(this),e,...t);return Mu.set(r,e.sort?e.sort():[e]),mt(r)}:Tf().includes(n)?function(...e){return n.apply(_i(this),e),mt(Ou.get(this))}:function(...e){return mt(n.apply(_i(this),e))}}function Rf(n){return typeof n=="function"?Af(n):(n instanceof IDBTransaction&&vf(n),yf(n,Ef())?new Proxy(n,bi):n)}function mt(n){if(n instanceof IDBRequest)return If(n);if(gi.has(n))return gi.get(n);const e=Rf(n);return e!==n&&(gi.set(n,e),to.set(e,n)),e}const _i=n=>to.get(n);function Sf(n,e,{blocked:t,upgrade:r,blocking:s,terminated:o}={}){const a=indexedDB.open(n,e),u=mt(a);return r&&a.addEventListener("upgradeneeded",h=>{r(mt(a.result),h.oldVersion,h.newVersion,mt(a.transaction),h)}),t&&a.addEventListener("blocked",h=>t(h.oldVersion,h.newVersion,h)),u.then(h=>{o&&h.addEventListener("close",()=>o()),s&&h.addEventListener("versionchange",d=>s(d.oldVersion,d.newVersion,d))}).catch(()=>{}),u}const Pf=["get","getKey","getAll","getAllKeys","count"],Cf=["put","add","delete","clear"],yi=new Map;function nc(n,e){if(!(n instanceof IDBDatabase&&!(e in n)&&typeof e=="string"))return;if(yi.get(e))return yi.get(e);const t=e.replace(/FromIndex$/,""),r=e!==t,s=Cf.includes(t);if(!(t in(r?IDBIndex:IDBObjectStore).prototype)||!(s||Pf.includes(t)))return;const o=async function(a,...u){const h=this.transaction(a,s?"readwrite":"readonly");let d=h.store;return r&&(d=d.index(u.shift())),(await Promise.all([d[t](...u),s&&h.done]))[0]};return yi.set(e,o),o}wf(n=>({...n,get:(e,t,r)=>nc(e,t)||n.get(e,t,r),has:(e,t)=>!!nc(e,t)||n.has(e,t)}));/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class bf{constructor(e){this.container=e}getPlatformInfoString(){return this.container.getProviders().map(t=>{if(Vf(t)){const r=t.getImmediate();return`${r.library}/${r.version}`}else return null}).filter(t=>t).join(" ")}}function Vf(n){return n.getComponent()?.type==="VERSION"}const Vi="@firebase/app",rc="0.14.0";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Ze=new eo("@firebase/app"),kf="@firebase/app-compat",Df="@firebase/analytics-compat",Nf="@firebase/analytics",Of="@firebase/app-check-compat",Mf="@firebase/app-check",Lf="@firebase/auth",xf="@firebase/auth-compat",Ff="@firebase/database",Uf="@firebase/data-connect",Bf="@firebase/database-compat",jf="@firebase/functions",qf="@firebase/functions-compat",$f="@firebase/installations",zf="@firebase/installations-compat",Hf="@firebase/messaging",Gf="@firebase/messaging-compat",Wf="@firebase/performance",Kf="@firebase/performance-compat",Qf="@firebase/remote-config",Jf="@firebase/remote-config-compat",Xf="@firebase/storage",Yf="@firebase/storage-compat",Zf="@firebase/firestore",ep="@firebase/ai",tp="@firebase/firestore-compat",np="firebase",rp="12.0.0";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const ki="[DEFAULT]",sp={[Vi]:"fire-core",[kf]:"fire-core-compat",[Nf]:"fire-analytics",[Df]:"fire-analytics-compat",[Mf]:"fire-app-check",[Of]:"fire-app-check-compat",[Lf]:"fire-auth",[xf]:"fire-auth-compat",[Ff]:"fire-rtdb",[Uf]:"fire-data-connect",[Bf]:"fire-rtdb-compat",[jf]:"fire-fn",[qf]:"fire-fn-compat",[$f]:"fire-iid",[zf]:"fire-iid-compat",[Hf]:"fire-fcm",[Gf]:"fire-fcm-compat",[Wf]:"fire-perf",[Kf]:"fire-perf-compat",[Qf]:"fire-rc",[Jf]:"fire-rc-compat",[Xf]:"fire-gcs",[Yf]:"fire-gcs-compat",[Zf]:"fire-fst",[tp]:"fire-fst-compat",[ep]:"fire-vertex","fire-js":"fire-js",[np]:"fire-js-all"};/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Jn=new Map,ip=new Map,Di=new Map;function sc(n,e){try{n.container.addComponent(e)}catch(t){Ze.debug(`Component ${e.name} failed to register with FirebaseApp ${n.name}`,t)}}function sn(n){const e=n.name;if(Di.has(e))return Ze.debug(`There were multiple attempts to register component ${e}.`),!1;Di.set(e,n);for(const t of Jn.values())sc(t,n);for(const t of ip.values())sc(t,n);return!0}function no(n,e){const t=n.container.getProvider("heartbeat").getImmediate({optional:!0});return t&&t.triggerHeartbeat(),n.container.getProvider(e)}function Ne(n){return n==null?!1:n.settings!==void 0}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const op={"no-app":"No Firebase App '{$appName}' has been created - call initializeApp() first","bad-app-name":"Illegal App name: '{$appName}'","duplicate-app":"Firebase App named '{$appName}' already exists with different options or config","app-deleted":"Firebase App named '{$appName}' already deleted","server-app-deleted":"Firebase Server App has been deleted","no-options":"Need to provide options, when not being deployed to hosting via source.","invalid-app-argument":"firebase.{$appName}() takes either no argument or a Firebase App instance.","invalid-log-argument":"First argument to `onLog` must be null or a function.","idb-open":"Error thrown when opening IndexedDB. Original error: {$originalErrorMessage}.","idb-get":"Error thrown when reading from IndexedDB. Original error: {$originalErrorMessage}.","idb-set":"Error thrown when writing to IndexedDB. Original error: {$originalErrorMessage}.","idb-delete":"Error thrown when deleting from IndexedDB. Original error: {$originalErrorMessage}.","finalization-registry-not-supported":"FirebaseServerApp deleteOnDeref field defined but the JS runtime does not support FinalizationRegistry.","invalid-server-app-environment":"FirebaseServerApp is not for use in browser environments."},gt=new ar("app","Firebase",op);/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ap{constructor(e,t,r){this._isDeleted=!1,this._options={...e},this._config={...t},this._name=t.name,this._automaticDataCollectionEnabled=t.automaticDataCollectionEnabled,this._container=r,this.container.addComponent(new jt("app",()=>this,"PUBLIC"))}get automaticDataCollectionEnabled(){return this.checkDestroyed(),this._automaticDataCollectionEnabled}set automaticDataCollectionEnabled(e){this.checkDestroyed(),this._automaticDataCollectionEnabled=e}get name(){return this.checkDestroyed(),this._name}get options(){return this.checkDestroyed(),this._options}get config(){return this.checkDestroyed(),this._config}get container(){return this._container}get isDeleted(){return this._isDeleted}set isDeleted(e){this._isDeleted=e}checkDestroyed(){if(this.isDeleted)throw gt.create("app-deleted",{appName:this._name})}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const pn=rp;function Lu(n,e={}){let t=n;typeof e!="object"&&(e={name:e});const r={name:ki,automaticDataCollectionEnabled:!0,...e},s=r.name;if(typeof s!="string"||!s)throw gt.create("bad-app-name",{appName:String(s)});if(t||(t=Vu()),!t)throw gt.create("no-options");const o=Jn.get(s);if(o){if(Bt(t,o.options)&&Bt(r,o.config))return o;throw gt.create("duplicate-app",{appName:s})}const a=new ff(s);for(const h of Di.values())a.addComponent(h);const u=new ap(t,r,a);return Jn.set(s,u),u}function xu(n=ki){const e=Jn.get(n);if(!e&&n===ki&&Vu())return Lu();if(!e)throw gt.create("no-app",{appName:n});return e}function ic(){return Array.from(Jn.values())}function _t(n,e,t){let r=sp[n]??n;t&&(r+=`-${t}`);const s=r.match(/\s|\//),o=e.match(/\s|\//);if(s||o){const a=[`Unable to register library "${r}" with version "${e}":`];s&&a.push(`library name "${r}" contains illegal characters (whitespace or "/")`),s&&o&&a.push("and"),o&&a.push(`version name "${e}" contains illegal characters (whitespace or "/")`),Ze.warn(a.join(" "));return}sn(new jt(`${r}-version`,()=>({library:r,version:e}),"VERSION"))}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const cp="firebase-heartbeat-database",up=1,Xn="firebase-heartbeat-store";let Ei=null;function Fu(){return Ei||(Ei=Sf(cp,up,{upgrade:(n,e)=>{switch(e){case 0:try{n.createObjectStore(Xn)}catch(t){console.warn(t)}}}}).catch(n=>{throw gt.create("idb-open",{originalErrorMessage:n.message})})),Ei}async function lp(n){try{const t=(await Fu()).transaction(Xn),r=await t.objectStore(Xn).get(Uu(n));return await t.done,r}catch(e){if(e instanceof it)Ze.warn(e.message);else{const t=gt.create("idb-get",{originalErrorMessage:e?.message});Ze.warn(t.message)}}}async function oc(n,e){try{const r=(await Fu()).transaction(Xn,"readwrite");await r.objectStore(Xn).put(e,Uu(n)),await r.done}catch(t){if(t instanceof it)Ze.warn(t.message);else{const r=gt.create("idb-set",{originalErrorMessage:t?.message});Ze.warn(r.message)}}}function Uu(n){return`${n.name}!${n.options.appId}`}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const hp=1024,dp=30;class fp{constructor(e){this.container=e,this._heartbeatsCache=null;const t=this.container.getProvider("app").getImmediate();this._storage=new mp(t),this._heartbeatsCachePromise=this._storage.read().then(r=>(this._heartbeatsCache=r,r))}async triggerHeartbeat(){try{const t=this.container.getProvider("platform-logger").getImmediate().getPlatformInfoString(),r=ac();if(this._heartbeatsCache?.heartbeats==null&&(this._heartbeatsCache=await this._heartbeatsCachePromise,this._heartbeatsCache?.heartbeats==null)||this._heartbeatsCache.lastSentHeartbeatDate===r||this._heartbeatsCache.heartbeats.some(s=>s.date===r))return;if(this._heartbeatsCache.heartbeats.push({date:r,agent:t}),this._heartbeatsCache.heartbeats.length>dp){const s=gp(this._heartbeatsCache.heartbeats);this._heartbeatsCache.heartbeats.splice(s,1)}return this._storage.overwrite(this._heartbeatsCache)}catch(e){Ze.warn(e)}}async getHeartbeatsHeader(){try{if(this._heartbeatsCache===null&&await this._heartbeatsCachePromise,this._heartbeatsCache?.heartbeats==null||this._heartbeatsCache.heartbeats.length===0)return"";const e=ac(),{heartbeatsToSend:t,unsentEntries:r}=pp(this._heartbeatsCache.heartbeats),s=ts(JSON.stringify({version:2,heartbeats:t}));return this._heartbeatsCache.lastSentHeartbeatDate=e,r.length>0?(this._heartbeatsCache.heartbeats=r,await this._storage.overwrite(this._heartbeatsCache)):(this._heartbeatsCache.heartbeats=[],this._storage.overwrite(this._heartbeatsCache)),s}catch(e){return Ze.warn(e),""}}}function ac(){return new Date().toISOString().substring(0,10)}function pp(n,e=hp){const t=[];let r=n.slice();for(const s of n){const o=t.find(a=>a.agent===s.agent);if(o){if(o.dates.push(s.date),cc(t)>e){o.dates.pop();break}}else if(t.push({agent:s.agent,dates:[s.date]}),cc(t)>e){t.pop();break}r=r.slice(1)}return{heartbeatsToSend:t,unsentEntries:r}}class mp{constructor(e){this.app=e,this._canUseIndexedDBPromise=this.runIndexedDBEnvironmentCheck()}async runIndexedDBEnvironmentCheck(){return ef()?tf().then(()=>!0).catch(()=>!1):!1}async read(){if(await this._canUseIndexedDBPromise){const t=await lp(this.app);return t?.heartbeats?t:{heartbeats:[]}}else return{heartbeats:[]}}async overwrite(e){if(await this._canUseIndexedDBPromise){const r=await this.read();return oc(this.app,{lastSentHeartbeatDate:e.lastSentHeartbeatDate??r.lastSentHeartbeatDate,heartbeats:e.heartbeats})}else return}async add(e){if(await this._canUseIndexedDBPromise){const r=await this.read();return oc(this.app,{lastSentHeartbeatDate:e.lastSentHeartbeatDate??r.lastSentHeartbeatDate,heartbeats:[...r.heartbeats,...e.heartbeats]})}else return}}function cc(n){return ts(JSON.stringify({version:2,heartbeats:n})).length}function gp(n){if(n.length===0)return-1;let e=0,t=n[0].date;for(let r=1;r<n.length;r++)n[r].date<t&&(t=n[r].date,e=r);return e}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function _p(n){sn(new jt("platform-logger",e=>new bf(e),"PRIVATE")),sn(new jt("heartbeat",e=>new fp(e),"PRIVATE")),_t(Vi,rc,n),_t(Vi,rc,"esm2020"),_t("fire-js","")}_p("");var yp="firebase",Ep="12.0.0";/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */_t(yp,Ep,"app");function Bu(){return{"dependent-sdk-initialized-before-auth":"Another Firebase SDK was initialized and is trying to use Auth before Auth is initialized. Please be sure to call `initializeAuth` or `getAuth` before starting any other Firebase SDK."}}const Tp=Bu,ju=new ar("auth","Firebase",Bu());/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const ns=new eo("@firebase/auth");function Ip(n,...e){ns.logLevel<=j.WARN&&ns.warn(`Auth (${pn}): ${n}`,...e)}function Hr(n,...e){ns.logLevel<=j.ERROR&&ns.error(`Auth (${pn}): ${n}`,...e)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function ze(n,...e){throw so(n,...e)}function Me(n,...e){return so(n,...e)}function ro(n,e,t){const r={...Tp(),[e]:t};return new ar("auth","Firebase",r).create(e,{appName:n.name})}function xt(n){return ro(n,"operation-not-supported-in-this-environment","Operations that alter the current user are not supported in conjunction with FirebaseServerApp")}function vp(n,e,t){const r=t;if(!(e instanceof r))throw r.name!==e.constructor.name&&ze(n,"argument-error"),ro(n,"argument-error",`Type of ${e.constructor.name} does not match expected instance.Did you pass a reference from a different Auth SDK?`)}function so(n,...e){if(typeof n!="string"){const t=e[0],r=[...e.slice(1)];return r[0]&&(r[0].appName=n.name),n._errorFactory.create(t,...r)}return ju.create(n,...e)}function L(n,e,...t){if(!n)throw so(e,...t)}function Je(n){const e="INTERNAL ASSERTION FAILED: "+n;throw Hr(e),new Error(e)}function et(n,e){n||Je(e)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Ni(){return typeof self<"u"&&self.location?.href||""}function wp(){return uc()==="http:"||uc()==="https:"}function uc(){return typeof self<"u"&&self.location?.protocol||null}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Ap(){return typeof navigator<"u"&&navigator&&"onLine"in navigator&&typeof navigator.onLine=="boolean"&&(wp()||Jd()||"connection"in navigator)?navigator.onLine:!0}function Rp(){if(typeof navigator>"u")return null;const n=navigator;return n.languages&&n.languages[0]||n.language||null}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ur{constructor(e,t){this.shortDelay=e,this.longDelay=t,et(t>e,"Short delay should be less than long delay!"),this.isMobile=Wd()||Xd()}get(){return Ap()?this.isMobile?this.longDelay:this.shortDelay:Math.min(5e3,this.shortDelay)}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function io(n,e){et(n.emulator,"Emulator should always be set here");const{url:t}=n.emulator;return e?`${t}${e.startsWith("/")?e.slice(1):e}`:t}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class qu{static initialize(e,t,r){this.fetchImpl=e,t&&(this.headersImpl=t),r&&(this.responseImpl=r)}static fetch(){if(this.fetchImpl)return this.fetchImpl;if(typeof self<"u"&&"fetch"in self)return self.fetch;if(typeof globalThis<"u"&&globalThis.fetch)return globalThis.fetch;if(typeof fetch<"u")return fetch;Je("Could not find fetch implementation, make sure you call FetchProvider.initialize() with an appropriate polyfill")}static headers(){if(this.headersImpl)return this.headersImpl;if(typeof self<"u"&&"Headers"in self)return self.Headers;if(typeof globalThis<"u"&&globalThis.Headers)return globalThis.Headers;if(typeof Headers<"u")return Headers;Je("Could not find Headers implementation, make sure you call FetchProvider.initialize() with an appropriate polyfill")}static response(){if(this.responseImpl)return this.responseImpl;if(typeof self<"u"&&"Response"in self)return self.Response;if(typeof globalThis<"u"&&globalThis.Response)return globalThis.Response;if(typeof Response<"u")return Response;Je("Could not find Response implementation, make sure you call FetchProvider.initialize() with an appropriate polyfill")}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Sp={CREDENTIAL_MISMATCH:"custom-token-mismatch",MISSING_CUSTOM_TOKEN:"internal-error",INVALID_IDENTIFIER:"invalid-email",MISSING_CONTINUE_URI:"internal-error",INVALID_PASSWORD:"wrong-password",MISSING_PASSWORD:"missing-password",INVALID_LOGIN_CREDENTIALS:"invalid-credential",EMAIL_EXISTS:"email-already-in-use",PASSWORD_LOGIN_DISABLED:"operation-not-allowed",INVALID_IDP_RESPONSE:"invalid-credential",INVALID_PENDING_TOKEN:"invalid-credential",FEDERATED_USER_ID_ALREADY_LINKED:"credential-already-in-use",MISSING_REQ_TYPE:"internal-error",EMAIL_NOT_FOUND:"user-not-found",RESET_PASSWORD_EXCEED_LIMIT:"too-many-requests",EXPIRED_OOB_CODE:"expired-action-code",INVALID_OOB_CODE:"invalid-action-code",MISSING_OOB_CODE:"internal-error",CREDENTIAL_TOO_OLD_LOGIN_AGAIN:"requires-recent-login",INVALID_ID_TOKEN:"invalid-user-token",TOKEN_EXPIRED:"user-token-expired",USER_NOT_FOUND:"user-token-expired",TOO_MANY_ATTEMPTS_TRY_LATER:"too-many-requests",PASSWORD_DOES_NOT_MEET_REQUIREMENTS:"password-does-not-meet-requirements",INVALID_CODE:"invalid-verification-code",INVALID_SESSION_INFO:"invalid-verification-id",INVALID_TEMPORARY_PROOF:"invalid-credential",MISSING_SESSION_INFO:"missing-verification-id",SESSION_EXPIRED:"code-expired",MISSING_ANDROID_PACKAGE_NAME:"missing-android-pkg-name",UNAUTHORIZED_DOMAIN:"unauthorized-continue-uri",INVALID_OAUTH_CLIENT_ID:"invalid-oauth-client-id",ADMIN_ONLY_OPERATION:"admin-restricted-operation",INVALID_MFA_PENDING_CREDENTIAL:"invalid-multi-factor-session",MFA_ENROLLMENT_NOT_FOUND:"multi-factor-info-not-found",MISSING_MFA_ENROLLMENT_ID:"missing-multi-factor-info",MISSING_MFA_PENDING_CREDENTIAL:"missing-multi-factor-session",SECOND_FACTOR_EXISTS:"second-factor-already-in-use",SECOND_FACTOR_LIMIT_EXCEEDED:"maximum-second-factor-count-exceeded",BLOCKING_FUNCTION_ERROR_RESPONSE:"internal-error",RECAPTCHA_NOT_ENABLED:"recaptcha-not-enabled",MISSING_RECAPTCHA_TOKEN:"missing-recaptcha-token",INVALID_RECAPTCHA_TOKEN:"invalid-recaptcha-token",INVALID_RECAPTCHA_ACTION:"invalid-recaptcha-action",MISSING_CLIENT_TYPE:"missing-client-type",MISSING_RECAPTCHA_VERSION:"missing-recaptcha-version",INVALID_RECAPTCHA_VERSION:"invalid-recaptcha-version",INVALID_REQ_TYPE:"invalid-req-type"};/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Pp=["/v1/accounts:signInWithCustomToken","/v1/accounts:signInWithEmailLink","/v1/accounts:signInWithIdp","/v1/accounts:signInWithPassword","/v1/accounts:signInWithPhoneNumber","/v1/token"],Cp=new ur(3e4,6e4);function oo(n,e){return n.tenantId&&!e.tenantId?{...e,tenantId:n.tenantId}:e}async function mn(n,e,t,r,s={}){return $u(n,s,async()=>{let o={},a={};r&&(e==="GET"?a=r:o={body:JSON.stringify(r)});const u=cr({key:n.config.apiKey,...a}).slice(1),h=await n._getAdditionalHeaders();h["Content-Type"]="application/json",n.languageCode&&(h["X-Firebase-Locale"]=n.languageCode);const d={method:e,headers:h,...o};return Qd()||(d.referrerPolicy="no-referrer"),n.emulatorConfig&&fn(n.emulatorConfig.host)&&(d.credentials="include"),qu.fetch()(await zu(n,n.config.apiHost,t,u),d)})}async function $u(n,e,t){n._canInitEmulator=!1;const r={...Sp,...e};try{const s=new Vp(n),o=await Promise.race([t(),s.promise]);s.clearNetworkTimeout();const a=await o.json();if("needConfirmation"in a)throw xr(n,"account-exists-with-different-credential",a);if(o.ok&&!("errorMessage"in a))return a;{const u=o.ok?a.errorMessage:a.error.message,[h,d]=u.split(" : ");if(h==="FEDERATED_USER_ID_ALREADY_LINKED")throw xr(n,"credential-already-in-use",a);if(h==="EMAIL_EXISTS")throw xr(n,"email-already-in-use",a);if(h==="USER_DISABLED")throw xr(n,"user-disabled",a);const p=r[h]||h.toLowerCase().replace(/[_\s]+/g,"-");if(d)throw ro(n,p,d);ze(n,p)}}catch(s){if(s instanceof it)throw s;ze(n,"network-request-failed",{message:String(s)})}}async function bp(n,e,t,r,s={}){const o=await mn(n,e,t,r,s);return"mfaPendingCredential"in o&&ze(n,"multi-factor-auth-required",{_serverResponse:o}),o}async function zu(n,e,t,r){const s=`${e}${t}?${r}`,o=n,a=o.config.emulator?io(n.config,s):`${n.config.apiScheme}://${s}`;return Pp.includes(t)&&(await o._persistenceManagerAvailable,o._getPersistenceType()==="COOKIE")?o._getPersistence()._getFinalTarget(a).toString():a}class Vp{clearNetworkTimeout(){clearTimeout(this.timer)}constructor(e){this.auth=e,this.timer=null,this.promise=new Promise((t,r)=>{this.timer=setTimeout(()=>r(Me(this.auth,"network-request-failed")),Cp.get())})}}function xr(n,e,t){const r={appName:n.name};t.email&&(r.email=t.email),t.phoneNumber&&(r.phoneNumber=t.phoneNumber);const s=Me(n,e,r);return s.customData._tokenResponse=t,s}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function kp(n,e){return mn(n,"POST","/v1/accounts:delete",e)}async function rs(n,e){return mn(n,"POST","/v1/accounts:lookup",e)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function zn(n){if(n)try{const e=new Date(Number(n));if(!isNaN(e.getTime()))return e.toUTCString()}catch{}}async function Dp(n,e=!1){const t=ce(n),r=await t.getIdToken(e),s=ao(r);L(s&&s.exp&&s.auth_time&&s.iat,t.auth,"internal-error");const o=typeof s.firebase=="object"?s.firebase:void 0,a=o?.sign_in_provider;return{claims:s,token:r,authTime:zn(Ti(s.auth_time)),issuedAtTime:zn(Ti(s.iat)),expirationTime:zn(Ti(s.exp)),signInProvider:a||null,signInSecondFactor:o?.sign_in_second_factor||null}}function Ti(n){return Number(n)*1e3}function ao(n){const[e,t,r]=n.split(".");if(e===void 0||t===void 0||r===void 0)return Hr("JWT malformed, contained fewer than 3 sections"),null;try{const s=Cu(t);return s?JSON.parse(s):(Hr("Failed to decode base64 JWT payload"),null)}catch(s){return Hr("Caught error parsing JWT payload as JSON",s?.toString()),null}}function lc(n){const e=ao(n);return L(e,"internal-error"),L(typeof e.exp<"u","internal-error"),L(typeof e.iat<"u","internal-error"),Number(e.exp)-Number(e.iat)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function Yn(n,e,t=!1){if(t)return e;try{return await e}catch(r){throw r instanceof it&&Np(r)&&n.auth.currentUser===n&&await n.auth.signOut(),r}}function Np({code:n}){return n==="auth/user-disabled"||n==="auth/user-token-expired"}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Op{constructor(e){this.user=e,this.isRunning=!1,this.timerId=null,this.errorBackoff=3e4}_start(){this.isRunning||(this.isRunning=!0,this.schedule())}_stop(){this.isRunning&&(this.isRunning=!1,this.timerId!==null&&clearTimeout(this.timerId))}getInterval(e){if(e){const t=this.errorBackoff;return this.errorBackoff=Math.min(this.errorBackoff*2,96e4),t}else{this.errorBackoff=3e4;const r=(this.user.stsTokenManager.expirationTime??0)-Date.now()-3e5;return Math.max(0,r)}}schedule(e=!1){if(!this.isRunning)return;const t=this.getInterval(e);this.timerId=setTimeout(async()=>{await this.iteration()},t)}async iteration(){try{await this.user.getIdToken(!0)}catch(e){e?.code==="auth/network-request-failed"&&this.schedule(!0);return}this.schedule()}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Oi{constructor(e,t){this.createdAt=e,this.lastLoginAt=t,this._initializeTime()}_initializeTime(){this.lastSignInTime=zn(this.lastLoginAt),this.creationTime=zn(this.createdAt)}_copy(e){this.createdAt=e.createdAt,this.lastLoginAt=e.lastLoginAt,this._initializeTime()}toJSON(){return{createdAt:this.createdAt,lastLoginAt:this.lastLoginAt}}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function ss(n){const e=n.auth,t=await n.getIdToken(),r=await Yn(n,rs(e,{idToken:t}));L(r?.users.length,e,"internal-error");const s=r.users[0];n._notifyReloadListener(s);const o=s.providerUserInfo?.length?Hu(s.providerUserInfo):[],a=Lp(n.providerData,o),u=n.isAnonymous,h=!(n.email&&s.passwordHash)&&!a?.length,d=u?h:!1,p={uid:s.localId,displayName:s.displayName||null,photoURL:s.photoUrl||null,email:s.email||null,emailVerified:s.emailVerified||!1,phoneNumber:s.phoneNumber||null,tenantId:s.tenantId||null,providerData:a,metadata:new Oi(s.createdAt,s.lastLoginAt),isAnonymous:d};Object.assign(n,p)}async function Mp(n){const e=ce(n);await ss(e),await e.auth._persistUserIfCurrent(e),e.auth._notifyListenersIfCurrent(e)}function Lp(n,e){return[...n.filter(r=>!e.some(s=>s.providerId===r.providerId)),...e]}function Hu(n){return n.map(({providerId:e,...t})=>({providerId:e,uid:t.rawId||"",displayName:t.displayName||null,email:t.email||null,phoneNumber:t.phoneNumber||null,photoURL:t.photoUrl||null}))}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function xp(n,e){const t=await $u(n,{},async()=>{const r=cr({grant_type:"refresh_token",refresh_token:e}).slice(1),{tokenApiHost:s,apiKey:o}=n.config,a=await zu(n,s,"/v1/token",`key=${o}`),u=await n._getAdditionalHeaders();u["Content-Type"]="application/x-www-form-urlencoded";const h={method:"POST",headers:u,body:r};return n.emulatorConfig&&fn(n.emulatorConfig.host)&&(h.credentials="include"),qu.fetch()(a,h)});return{accessToken:t.access_token,expiresIn:t.expires_in,refreshToken:t.refresh_token}}async function Fp(n,e){return mn(n,"POST","/v2/accounts:revokeToken",oo(n,e))}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class en{constructor(){this.refreshToken=null,this.accessToken=null,this.expirationTime=null}get isExpired(){return!this.expirationTime||Date.now()>this.expirationTime-3e4}updateFromServerResponse(e){L(e.idToken,"internal-error"),L(typeof e.idToken<"u","internal-error"),L(typeof e.refreshToken<"u","internal-error");const t="expiresIn"in e&&typeof e.expiresIn<"u"?Number(e.expiresIn):lc(e.idToken);this.updateTokensAndExpiration(e.idToken,e.refreshToken,t)}updateFromIdToken(e){L(e.length!==0,"internal-error");const t=lc(e);this.updateTokensAndExpiration(e,null,t)}async getToken(e,t=!1){return!t&&this.accessToken&&!this.isExpired?this.accessToken:(L(this.refreshToken,e,"user-token-expired"),this.refreshToken?(await this.refresh(e,this.refreshToken),this.accessToken):null)}clearRefreshToken(){this.refreshToken=null}async refresh(e,t){const{accessToken:r,refreshToken:s,expiresIn:o}=await xp(e,t);this.updateTokensAndExpiration(r,s,Number(o))}updateTokensAndExpiration(e,t,r){this.refreshToken=t||null,this.accessToken=e||null,this.expirationTime=Date.now()+r*1e3}static fromJSON(e,t){const{refreshToken:r,accessToken:s,expirationTime:o}=t,a=new en;return r&&(L(typeof r=="string","internal-error",{appName:e}),a.refreshToken=r),s&&(L(typeof s=="string","internal-error",{appName:e}),a.accessToken=s),o&&(L(typeof o=="number","internal-error",{appName:e}),a.expirationTime=o),a}toJSON(){return{refreshToken:this.refreshToken,accessToken:this.accessToken,expirationTime:this.expirationTime}}_assign(e){this.accessToken=e.accessToken,this.refreshToken=e.refreshToken,this.expirationTime=e.expirationTime}_clone(){return Object.assign(new en,this.toJSON())}_performRefresh(){return Je("not implemented")}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function lt(n,e){L(typeof n=="string"||typeof n>"u","internal-error",{appName:e})}class Oe{constructor({uid:e,auth:t,stsTokenManager:r,...s}){this.providerId="firebase",this.proactiveRefresh=new Op(this),this.reloadUserInfo=null,this.reloadListener=null,this.uid=e,this.auth=t,this.stsTokenManager=r,this.accessToken=r.accessToken,this.displayName=s.displayName||null,this.email=s.email||null,this.emailVerified=s.emailVerified||!1,this.phoneNumber=s.phoneNumber||null,this.photoURL=s.photoURL||null,this.isAnonymous=s.isAnonymous||!1,this.tenantId=s.tenantId||null,this.providerData=s.providerData?[...s.providerData]:[],this.metadata=new Oi(s.createdAt||void 0,s.lastLoginAt||void 0)}async getIdToken(e){const t=await Yn(this,this.stsTokenManager.getToken(this.auth,e));return L(t,this.auth,"internal-error"),this.accessToken!==t&&(this.accessToken=t,await this.auth._persistUserIfCurrent(this),this.auth._notifyListenersIfCurrent(this)),t}getIdTokenResult(e){return Dp(this,e)}reload(){return Mp(this)}_assign(e){this!==e&&(L(this.uid===e.uid,this.auth,"internal-error"),this.displayName=e.displayName,this.photoURL=e.photoURL,this.email=e.email,this.emailVerified=e.emailVerified,this.phoneNumber=e.phoneNumber,this.isAnonymous=e.isAnonymous,this.tenantId=e.tenantId,this.providerData=e.providerData.map(t=>({...t})),this.metadata._copy(e.metadata),this.stsTokenManager._assign(e.stsTokenManager))}_clone(e){const t=new Oe({...this,auth:e,stsTokenManager:this.stsTokenManager._clone()});return t.metadata._copy(this.metadata),t}_onReload(e){L(!this.reloadListener,this.auth,"internal-error"),this.reloadListener=e,this.reloadUserInfo&&(this._notifyReloadListener(this.reloadUserInfo),this.reloadUserInfo=null)}_notifyReloadListener(e){this.reloadListener?this.reloadListener(e):this.reloadUserInfo=e}_startProactiveRefresh(){this.proactiveRefresh._start()}_stopProactiveRefresh(){this.proactiveRefresh._stop()}async _updateTokensIfNecessary(e,t=!1){let r=!1;e.idToken&&e.idToken!==this.stsTokenManager.accessToken&&(this.stsTokenManager.updateFromServerResponse(e),r=!0),t&&await ss(this),await this.auth._persistUserIfCurrent(this),r&&this.auth._notifyListenersIfCurrent(this)}async delete(){if(Ne(this.auth.app))return Promise.reject(xt(this.auth));const e=await this.getIdToken();return await Yn(this,kp(this.auth,{idToken:e})),this.stsTokenManager.clearRefreshToken(),this.auth.signOut()}toJSON(){return{uid:this.uid,email:this.email||void 0,emailVerified:this.emailVerified,displayName:this.displayName||void 0,isAnonymous:this.isAnonymous,photoURL:this.photoURL||void 0,phoneNumber:this.phoneNumber||void 0,tenantId:this.tenantId||void 0,providerData:this.providerData.map(e=>({...e})),stsTokenManager:this.stsTokenManager.toJSON(),_redirectEventId:this._redirectEventId,...this.metadata.toJSON(),apiKey:this.auth.config.apiKey,appName:this.auth.name}}get refreshToken(){return this.stsTokenManager.refreshToken||""}static _fromJSON(e,t){const r=t.displayName??void 0,s=t.email??void 0,o=t.phoneNumber??void 0,a=t.photoURL??void 0,u=t.tenantId??void 0,h=t._redirectEventId??void 0,d=t.createdAt??void 0,p=t.lastLoginAt??void 0,{uid:y,emailVerified:E,isAnonymous:C,providerData:b,stsTokenManager:O}=t;L(y&&O,e,"internal-error");const k=en.fromJSON(this.name,O);L(typeof y=="string",e,"internal-error"),lt(r,e.name),lt(s,e.name),L(typeof E=="boolean",e,"internal-error"),L(typeof C=="boolean",e,"internal-error"),lt(o,e.name),lt(a,e.name),lt(u,e.name),lt(h,e.name),lt(d,e.name),lt(p,e.name);const z=new Oe({uid:y,auth:e,email:s,emailVerified:E,displayName:r,isAnonymous:C,photoURL:a,phoneNumber:o,tenantId:u,stsTokenManager:k,createdAt:d,lastLoginAt:p});return b&&Array.isArray(b)&&(z.providerData=b.map(B=>({...B}))),h&&(z._redirectEventId=h),z}static async _fromIdTokenResponse(e,t,r=!1){const s=new en;s.updateFromServerResponse(t);const o=new Oe({uid:t.localId,auth:e,stsTokenManager:s,isAnonymous:r});return await ss(o),o}static async _fromGetAccountInfoResponse(e,t,r){const s=t.users[0];L(s.localId!==void 0,"internal-error");const o=s.providerUserInfo!==void 0?Hu(s.providerUserInfo):[],a=!(s.email&&s.passwordHash)&&!o?.length,u=new en;u.updateFromIdToken(r);const h=new Oe({uid:s.localId,auth:e,stsTokenManager:u,isAnonymous:a}),d={uid:s.localId,displayName:s.displayName||null,photoURL:s.photoUrl||null,email:s.email||null,emailVerified:s.emailVerified||!1,phoneNumber:s.phoneNumber||null,tenantId:s.tenantId||null,providerData:o,metadata:new Oi(s.createdAt,s.lastLoginAt),isAnonymous:!(s.email&&s.passwordHash)&&!o?.length};return Object.assign(h,d),h}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const hc=new Map;function Xe(n){et(n instanceof Function,"Expected a class definition");let e=hc.get(n);return e?(et(e instanceof n,"Instance stored in cache mismatched with class"),e):(e=new n,hc.set(n,e),e)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Gu{constructor(){this.type="NONE",this.storage={}}async _isAvailable(){return!0}async _set(e,t){this.storage[e]=t}async _get(e){const t=this.storage[e];return t===void 0?null:t}async _remove(e){delete this.storage[e]}_addListener(e,t){}_removeListener(e,t){}}Gu.type="NONE";const dc=Gu;/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Gr(n,e,t){return`firebase:${n}:${e}:${t}`}class tn{constructor(e,t,r){this.persistence=e,this.auth=t,this.userKey=r;const{config:s,name:o}=this.auth;this.fullUserKey=Gr(this.userKey,s.apiKey,o),this.fullPersistenceKey=Gr("persistence",s.apiKey,o),this.boundEventHandler=t._onStorageEvent.bind(t),this.persistence._addListener(this.fullUserKey,this.boundEventHandler)}setCurrentUser(e){return this.persistence._set(this.fullUserKey,e.toJSON())}async getCurrentUser(){const e=await this.persistence._get(this.fullUserKey);if(!e)return null;if(typeof e=="string"){const t=await rs(this.auth,{idToken:e}).catch(()=>{});return t?Oe._fromGetAccountInfoResponse(this.auth,t,e):null}return Oe._fromJSON(this.auth,e)}removeCurrentUser(){return this.persistence._remove(this.fullUserKey)}savePersistenceForRedirect(){return this.persistence._set(this.fullPersistenceKey,this.persistence.type)}async setPersistence(e){if(this.persistence===e)return;const t=await this.getCurrentUser();if(await this.removeCurrentUser(),this.persistence=e,t)return this.setCurrentUser(t)}delete(){this.persistence._removeListener(this.fullUserKey,this.boundEventHandler)}static async create(e,t,r="authUser"){if(!t.length)return new tn(Xe(dc),e,r);const s=(await Promise.all(t.map(async d=>{if(await d._isAvailable())return d}))).filter(d=>d);let o=s[0]||Xe(dc);const a=Gr(r,e.config.apiKey,e.name);let u=null;for(const d of t)try{const p=await d._get(a);if(p){let y;if(typeof p=="string"){const E=await rs(e,{idToken:p}).catch(()=>{});if(!E)break;y=await Oe._fromGetAccountInfoResponse(e,E,p)}else y=Oe._fromJSON(e,p);d!==o&&(u=y),o=d;break}}catch{}const h=s.filter(d=>d._shouldAllowMigration);return!o._shouldAllowMigration||!h.length?new tn(o,e,r):(o=h[0],u&&await o._set(a,u.toJSON()),await Promise.all(t.map(async d=>{if(d!==o)try{await d._remove(a)}catch{}})),new tn(o,e,r))}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function fc(n){const e=n.toLowerCase();if(e.includes("opera/")||e.includes("opr/")||e.includes("opios/"))return"Opera";if(Ju(e))return"IEMobile";if(e.includes("msie")||e.includes("trident/"))return"IE";if(e.includes("edge/"))return"Edge";if(Wu(e))return"Firefox";if(e.includes("silk/"))return"Silk";if(Yu(e))return"Blackberry";if(Zu(e))return"Webos";if(Ku(e))return"Safari";if((e.includes("chrome/")||Qu(e))&&!e.includes("edge/"))return"Chrome";if(Xu(e))return"Android";{const t=/([a-zA-Z\d\.]+)\/[a-zA-Z\d\.]*$/,r=n.match(t);if(r?.length===2)return r[1]}return"Other"}function Wu(n=ve()){return/firefox\//i.test(n)}function Ku(n=ve()){const e=n.toLowerCase();return e.includes("safari/")&&!e.includes("chrome/")&&!e.includes("crios/")&&!e.includes("android")}function Qu(n=ve()){return/crios\//i.test(n)}function Ju(n=ve()){return/iemobile/i.test(n)}function Xu(n=ve()){return/android/i.test(n)}function Yu(n=ve()){return/blackberry/i.test(n)}function Zu(n=ve()){return/webos/i.test(n)}function co(n=ve()){return/iphone|ipad|ipod/i.test(n)||/macintosh/i.test(n)&&/mobile/i.test(n)}function Up(n=ve()){return co(n)&&!!window.navigator?.standalone}function Bp(){return Yd()&&document.documentMode===10}function el(n=ve()){return co(n)||Xu(n)||Zu(n)||Yu(n)||/windows phone/i.test(n)||Ju(n)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function tl(n,e=[]){let t;switch(n){case"Browser":t=fc(ve());break;case"Worker":t=`${fc(ve())}-${n}`;break;default:t=n}const r=e.length?e.join(","):"FirebaseCore-web";return`${t}/JsCore/${pn}/${r}`}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class jp{constructor(e){this.auth=e,this.queue=[]}pushCallback(e,t){const r=o=>new Promise((a,u)=>{try{const h=e(o);a(h)}catch(h){u(h)}});r.onAbort=t,this.queue.push(r);const s=this.queue.length-1;return()=>{this.queue[s]=()=>Promise.resolve()}}async runMiddleware(e){if(this.auth.currentUser===e)return;const t=[];try{for(const r of this.queue)await r(e),r.onAbort&&t.push(r.onAbort)}catch(r){t.reverse();for(const s of t)try{s()}catch{}throw this.auth._errorFactory.create("login-blocked",{originalMessage:r?.message})}}}/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function qp(n,e={}){return mn(n,"GET","/v2/passwordPolicy",oo(n,e))}/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const $p=6;class zp{constructor(e){const t=e.customStrengthOptions;this.customStrengthOptions={},this.customStrengthOptions.minPasswordLength=t.minPasswordLength??$p,t.maxPasswordLength&&(this.customStrengthOptions.maxPasswordLength=t.maxPasswordLength),t.containsLowercaseCharacter!==void 0&&(this.customStrengthOptions.containsLowercaseLetter=t.containsLowercaseCharacter),t.containsUppercaseCharacter!==void 0&&(this.customStrengthOptions.containsUppercaseLetter=t.containsUppercaseCharacter),t.containsNumericCharacter!==void 0&&(this.customStrengthOptions.containsNumericCharacter=t.containsNumericCharacter),t.containsNonAlphanumericCharacter!==void 0&&(this.customStrengthOptions.containsNonAlphanumericCharacter=t.containsNonAlphanumericCharacter),this.enforcementState=e.enforcementState,this.enforcementState==="ENFORCEMENT_STATE_UNSPECIFIED"&&(this.enforcementState="OFF"),this.allowedNonAlphanumericCharacters=e.allowedNonAlphanumericCharacters?.join("")??"",this.forceUpgradeOnSignin=e.forceUpgradeOnSignin??!1,this.schemaVersion=e.schemaVersion}validatePassword(e){const t={isValid:!0,passwordPolicy:this};return this.validatePasswordLengthOptions(e,t),this.validatePasswordCharacterOptions(e,t),t.isValid&&(t.isValid=t.meetsMinPasswordLength??!0),t.isValid&&(t.isValid=t.meetsMaxPasswordLength??!0),t.isValid&&(t.isValid=t.containsLowercaseLetter??!0),t.isValid&&(t.isValid=t.containsUppercaseLetter??!0),t.isValid&&(t.isValid=t.containsNumericCharacter??!0),t.isValid&&(t.isValid=t.containsNonAlphanumericCharacter??!0),t}validatePasswordLengthOptions(e,t){const r=this.customStrengthOptions.minPasswordLength,s=this.customStrengthOptions.maxPasswordLength;r&&(t.meetsMinPasswordLength=e.length>=r),s&&(t.meetsMaxPasswordLength=e.length<=s)}validatePasswordCharacterOptions(e,t){this.updatePasswordCharacterOptionsStatuses(t,!1,!1,!1,!1);let r;for(let s=0;s<e.length;s++)r=e.charAt(s),this.updatePasswordCharacterOptionsStatuses(t,r>="a"&&r<="z",r>="A"&&r<="Z",r>="0"&&r<="9",this.allowedNonAlphanumericCharacters.includes(r))}updatePasswordCharacterOptionsStatuses(e,t,r,s,o){this.customStrengthOptions.containsLowercaseLetter&&(e.containsLowercaseLetter||(e.containsLowercaseLetter=t)),this.customStrengthOptions.containsUppercaseLetter&&(e.containsUppercaseLetter||(e.containsUppercaseLetter=r)),this.customStrengthOptions.containsNumericCharacter&&(e.containsNumericCharacter||(e.containsNumericCharacter=s)),this.customStrengthOptions.containsNonAlphanumericCharacter&&(e.containsNonAlphanumericCharacter||(e.containsNonAlphanumericCharacter=o))}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Hp{constructor(e,t,r,s){this.app=e,this.heartbeatServiceProvider=t,this.appCheckServiceProvider=r,this.config=s,this.currentUser=null,this.emulatorConfig=null,this.operations=Promise.resolve(),this.authStateSubscription=new pc(this),this.idTokenSubscription=new pc(this),this.beforeStateQueue=new jp(this),this.redirectUser=null,this.isProactiveRefreshEnabled=!1,this.EXPECTED_PASSWORD_POLICY_SCHEMA_VERSION=1,this._canInitEmulator=!0,this._isInitialized=!1,this._deleted=!1,this._initializationPromise=null,this._popupRedirectResolver=null,this._errorFactory=ju,this._agentRecaptchaConfig=null,this._tenantRecaptchaConfigs={},this._projectPasswordPolicy=null,this._tenantPasswordPolicies={},this._resolvePersistenceManagerAvailable=void 0,this.lastNotifiedUid=void 0,this.languageCode=null,this.tenantId=null,this.settings={appVerificationDisabledForTesting:!1},this.frameworks=[],this.name=e.name,this.clientVersion=s.sdkClientVersion,this._persistenceManagerAvailable=new Promise(o=>this._resolvePersistenceManagerAvailable=o)}_initializeWithPersistence(e,t){return t&&(this._popupRedirectResolver=Xe(t)),this._initializationPromise=this.queue(async()=>{if(!this._deleted&&(this.persistenceManager=await tn.create(this,e),this._resolvePersistenceManagerAvailable?.(),!this._deleted)){if(this._popupRedirectResolver?._shouldInitProactively)try{await this._popupRedirectResolver._initialize(this)}catch{}await this.initializeCurrentUser(t),this.lastNotifiedUid=this.currentUser?.uid||null,!this._deleted&&(this._isInitialized=!0)}}),this._initializationPromise}async _onStorageEvent(){if(this._deleted)return;const e=await this.assertedPersistence.getCurrentUser();if(!(!this.currentUser&&!e)){if(this.currentUser&&e&&this.currentUser.uid===e.uid){this._currentUser._assign(e),await this.currentUser.getIdToken();return}await this._updateCurrentUser(e,!0)}}async initializeCurrentUserFromIdToken(e){try{const t=await rs(this,{idToken:e}),r=await Oe._fromGetAccountInfoResponse(this,t,e);await this.directlySetCurrentUser(r)}catch(t){console.warn("FirebaseServerApp could not login user with provided authIdToken: ",t),await this.directlySetCurrentUser(null)}}async initializeCurrentUser(e){if(Ne(this.app)){const o=this.app.settings.authIdToken;return o?new Promise(a=>{setTimeout(()=>this.initializeCurrentUserFromIdToken(o).then(a,a))}):this.directlySetCurrentUser(null)}const t=await this.assertedPersistence.getCurrentUser();let r=t,s=!1;if(e&&this.config.authDomain){await this.getOrInitRedirectPersistenceManager();const o=this.redirectUser?._redirectEventId,a=r?._redirectEventId,u=await this.tryRedirectSignIn(e);(!o||o===a)&&u?.user&&(r=u.user,s=!0)}if(!r)return this.directlySetCurrentUser(null);if(!r._redirectEventId){if(s)try{await this.beforeStateQueue.runMiddleware(r)}catch(o){r=t,this._popupRedirectResolver._overrideRedirectResult(this,()=>Promise.reject(o))}return r?this.reloadAndSetCurrentUserOrClear(r):this.directlySetCurrentUser(null)}return L(this._popupRedirectResolver,this,"argument-error"),await this.getOrInitRedirectPersistenceManager(),this.redirectUser&&this.redirectUser._redirectEventId===r._redirectEventId?this.directlySetCurrentUser(r):this.reloadAndSetCurrentUserOrClear(r)}async tryRedirectSignIn(e){let t=null;try{t=await this._popupRedirectResolver._completeRedirectFn(this,e,!0)}catch{await this._setRedirectUser(null)}return t}async reloadAndSetCurrentUserOrClear(e){try{await ss(e)}catch(t){if(t?.code!=="auth/network-request-failed")return this.directlySetCurrentUser(null)}return this.directlySetCurrentUser(e)}useDeviceLanguage(){this.languageCode=Rp()}async _delete(){this._deleted=!0}async updateCurrentUser(e){if(Ne(this.app))return Promise.reject(xt(this));const t=e?ce(e):null;return t&&L(t.auth.config.apiKey===this.config.apiKey,this,"invalid-user-token"),this._updateCurrentUser(t&&t._clone(this))}async _updateCurrentUser(e,t=!1){if(!this._deleted)return e&&L(this.tenantId===e.tenantId,this,"tenant-id-mismatch"),t||await this.beforeStateQueue.runMiddleware(e),this.queue(async()=>{await this.directlySetCurrentUser(e),this.notifyAuthListeners()})}async signOut(){return Ne(this.app)?Promise.reject(xt(this)):(await this.beforeStateQueue.runMiddleware(null),(this.redirectPersistenceManager||this._popupRedirectResolver)&&await this._setRedirectUser(null),this._updateCurrentUser(null,!0))}setPersistence(e){return Ne(this.app)?Promise.reject(xt(this)):this.queue(async()=>{await this.assertedPersistence.setPersistence(Xe(e))})}_getRecaptchaConfig(){return this.tenantId==null?this._agentRecaptchaConfig:this._tenantRecaptchaConfigs[this.tenantId]}async validatePassword(e){this._getPasswordPolicyInternal()||await this._updatePasswordPolicy();const t=this._getPasswordPolicyInternal();return t.schemaVersion!==this.EXPECTED_PASSWORD_POLICY_SCHEMA_VERSION?Promise.reject(this._errorFactory.create("unsupported-password-policy-schema-version",{})):t.validatePassword(e)}_getPasswordPolicyInternal(){return this.tenantId===null?this._projectPasswordPolicy:this._tenantPasswordPolicies[this.tenantId]}async _updatePasswordPolicy(){const e=await qp(this),t=new zp(e);this.tenantId===null?this._projectPasswordPolicy=t:this._tenantPasswordPolicies[this.tenantId]=t}_getPersistenceType(){return this.assertedPersistence.persistence.type}_getPersistence(){return this.assertedPersistence.persistence}_updateErrorMap(e){this._errorFactory=new ar("auth","Firebase",e())}onAuthStateChanged(e,t,r){return this.registerStateListener(this.authStateSubscription,e,t,r)}beforeAuthStateChanged(e,t){return this.beforeStateQueue.pushCallback(e,t)}onIdTokenChanged(e,t,r){return this.registerStateListener(this.idTokenSubscription,e,t,r)}authStateReady(){return new Promise((e,t)=>{if(this.currentUser)e();else{const r=this.onAuthStateChanged(()=>{r(),e()},t)}})}async revokeAccessToken(e){if(this.currentUser){const t=await this.currentUser.getIdToken(),r={providerId:"apple.com",tokenType:"ACCESS_TOKEN",token:e,idToken:t};this.tenantId!=null&&(r.tenantId=this.tenantId),await Fp(this,r)}}toJSON(){return{apiKey:this.config.apiKey,authDomain:this.config.authDomain,appName:this.name,currentUser:this._currentUser?.toJSON()}}async _setRedirectUser(e,t){const r=await this.getOrInitRedirectPersistenceManager(t);return e===null?r.removeCurrentUser():r.setCurrentUser(e)}async getOrInitRedirectPersistenceManager(e){if(!this.redirectPersistenceManager){const t=e&&Xe(e)||this._popupRedirectResolver;L(t,this,"argument-error"),this.redirectPersistenceManager=await tn.create(this,[Xe(t._redirectPersistence)],"redirectUser"),this.redirectUser=await this.redirectPersistenceManager.getCurrentUser()}return this.redirectPersistenceManager}async _redirectUserForId(e){return this._isInitialized&&await this.queue(async()=>{}),this._currentUser?._redirectEventId===e?this._currentUser:this.redirectUser?._redirectEventId===e?this.redirectUser:null}async _persistUserIfCurrent(e){if(e===this.currentUser)return this.queue(async()=>this.directlySetCurrentUser(e))}_notifyListenersIfCurrent(e){e===this.currentUser&&this.notifyAuthListeners()}_key(){return`${this.config.authDomain}:${this.config.apiKey}:${this.name}`}_startProactiveRefresh(){this.isProactiveRefreshEnabled=!0,this.currentUser&&this._currentUser._startProactiveRefresh()}_stopProactiveRefresh(){this.isProactiveRefreshEnabled=!1,this.currentUser&&this._currentUser._stopProactiveRefresh()}get _currentUser(){return this.currentUser}notifyAuthListeners(){if(!this._isInitialized)return;this.idTokenSubscription.next(this.currentUser);const e=this.currentUser?.uid??null;this.lastNotifiedUid!==e&&(this.lastNotifiedUid=e,this.authStateSubscription.next(this.currentUser))}registerStateListener(e,t,r,s){if(this._deleted)return()=>{};const o=typeof t=="function"?t:t.next.bind(t);let a=!1;const u=this._isInitialized?Promise.resolve():this._initializationPromise;if(L(u,this,"internal-error"),u.then(()=>{a||o(this.currentUser)}),typeof t=="function"){const h=e.addObserver(t,r,s);return()=>{a=!0,h()}}else{const h=e.addObserver(t);return()=>{a=!0,h()}}}async directlySetCurrentUser(e){this.currentUser&&this.currentUser!==e&&this._currentUser._stopProactiveRefresh(),e&&this.isProactiveRefreshEnabled&&e._startProactiveRefresh(),this.currentUser=e,e?await this.assertedPersistence.setCurrentUser(e):await this.assertedPersistence.removeCurrentUser()}queue(e){return this.operations=this.operations.then(e,e),this.operations}get assertedPersistence(){return L(this.persistenceManager,this,"internal-error"),this.persistenceManager}_logFramework(e){!e||this.frameworks.includes(e)||(this.frameworks.push(e),this.frameworks.sort(),this.clientVersion=tl(this.config.clientPlatform,this._getFrameworks()))}_getFrameworks(){return this.frameworks}async _getAdditionalHeaders(){const e={"X-Client-Version":this.clientVersion};this.app.options.appId&&(e["X-Firebase-gmpid"]=this.app.options.appId);const t=await this.heartbeatServiceProvider.getImmediate({optional:!0})?.getHeartbeatsHeader();t&&(e["X-Firebase-Client"]=t);const r=await this._getAppCheckToken();return r&&(e["X-Firebase-AppCheck"]=r),e}async _getAppCheckToken(){if(Ne(this.app)&&this.app.settings.appCheckToken)return this.app.settings.appCheckToken;const e=await this.appCheckServiceProvider.getImmediate({optional:!0})?.getToken();return e?.error&&Ip(`Error while retrieving App Check token: ${e.error}`),e?.token}}function Ts(n){return ce(n)}class pc{constructor(e){this.auth=e,this.observer=null,this.addObserver=af(t=>this.observer=t)}get next(){return L(this.observer,this.auth,"internal-error"),this.observer.next.bind(this.observer)}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */let uo={async loadJS(){throw new Error("Unable to load external scripts")},recaptchaV2Script:"",recaptchaEnterpriseScript:"",gapiScript:""};function Gp(n){uo=n}function Wp(n){return uo.loadJS(n)}function Kp(){return uo.gapiScript}function Qp(n){return`__${n}${Math.floor(Math.random()*1e6)}`}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Jp(n,e){const t=no(n,"auth");if(t.isInitialized()){const s=t.getImmediate(),o=t.getOptions();if(Bt(o,e??{}))return s;ze(s,"already-initialized")}return t.initialize({options:e})}function Xp(n,e){const t=e?.persistence||[],r=(Array.isArray(t)?t:[t]).map(Xe);e?.errorMap&&n._updateErrorMap(e.errorMap),n._initializeWithPersistence(r,e?.popupRedirectResolver)}function Yp(n,e,t){const r=Ts(n);L(/^https?:\/\//.test(e),r,"invalid-emulator-scheme");const s=!1,o=nl(e),{host:a,port:u}=Zp(e),h=u===null?"":`:${u}`,d={url:`${o}//${a}${h}/`},p=Object.freeze({host:a,port:u,protocol:o.replace(":",""),options:Object.freeze({disableWarnings:s})});if(!r._canInitEmulator){L(r.config.emulator&&r.emulatorConfig,r,"emulator-config-failed"),L(Bt(d,r.config.emulator)&&Bt(p,r.emulatorConfig),r,"emulator-config-failed");return}r.config.emulator=d,r.emulatorConfig=p,r.settings.appVerificationDisabledForTesting=!0,fn(a)?(Du(`${o}//${a}${h}`),Nu("Auth",!0)):em()}function nl(n){const e=n.indexOf(":");return e<0?"":n.substr(0,e+1)}function Zp(n){const e=nl(n),t=/(\/\/)?([^?#/]+)/.exec(n.substr(e.length));if(!t)return{host:"",port:null};const r=t[2].split("@").pop()||"",s=/^(\[[^\]]+\])(:|$)/.exec(r);if(s){const o=s[1];return{host:o,port:mc(r.substr(o.length+1))}}else{const[o,a]=r.split(":");return{host:o,port:mc(a)}}}function mc(n){if(!n)return null;const e=Number(n);return isNaN(e)?null:e}function em(){function n(){const e=document.createElement("p"),t=e.style;e.innerText="Running in emulator mode. Do not use with production credentials.",t.position="fixed",t.width="100%",t.backgroundColor="#ffffff",t.border=".1em solid #000000",t.color="#b50000",t.bottom="0px",t.left="0px",t.margin="0px",t.zIndex="10000",t.textAlign="center",e.classList.add("firebase-emulator-warning"),document.body.appendChild(e)}typeof console<"u"&&typeof console.info=="function"&&console.info("WARNING: You are using the Auth Emulator, which is intended for local testing only.  Do not use with production credentials."),typeof window<"u"&&typeof document<"u"&&(document.readyState==="loading"?window.addEventListener("DOMContentLoaded",n):n())}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class rl{constructor(e,t){this.providerId=e,this.signInMethod=t}toJSON(){return Je("not implemented")}_getIdTokenResponse(e){return Je("not implemented")}_linkToIdToken(e,t){return Je("not implemented")}_getReauthenticationResolver(e){return Je("not implemented")}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function nn(n,e){return bp(n,"POST","/v1/accounts:signInWithIdp",oo(n,e))}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const tm="http://localhost";class tt extends rl{constructor(){super(...arguments),this.pendingToken=null}static _fromParams(e){const t=new tt(e.providerId,e.signInMethod);return e.idToken||e.accessToken?(e.idToken&&(t.idToken=e.idToken),e.accessToken&&(t.accessToken=e.accessToken),e.nonce&&!e.pendingToken&&(t.nonce=e.nonce),e.pendingToken&&(t.pendingToken=e.pendingToken)):e.oauthToken&&e.oauthTokenSecret?(t.accessToken=e.oauthToken,t.secret=e.oauthTokenSecret):ze("argument-error"),t}toJSON(){return{idToken:this.idToken,accessToken:this.accessToken,secret:this.secret,nonce:this.nonce,pendingToken:this.pendingToken,providerId:this.providerId,signInMethod:this.signInMethod}}static fromJSON(e){const t=typeof e=="string"?JSON.parse(e):e,{providerId:r,signInMethod:s,...o}=t;if(!r||!s)return null;const a=new tt(r,s);return a.idToken=o.idToken||void 0,a.accessToken=o.accessToken||void 0,a.secret=o.secret,a.nonce=o.nonce,a.pendingToken=o.pendingToken||null,a}_getIdTokenResponse(e){const t=this.buildRequest();return nn(e,t)}_linkToIdToken(e,t){const r=this.buildRequest();return r.idToken=t,nn(e,r)}_getReauthenticationResolver(e){const t=this.buildRequest();return t.autoCreate=!1,nn(e,t)}buildRequest(){const e={requestUri:tm,returnSecureToken:!0};if(this.pendingToken)e.pendingToken=this.pendingToken;else{const t={};this.idToken&&(t.id_token=this.idToken),this.accessToken&&(t.access_token=this.accessToken),this.secret&&(t.oauth_token_secret=this.secret),t.providerId=this.providerId,this.nonce&&!this.pendingToken&&(t.nonce=this.nonce),e.postBody=cr(t)}return e}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class lo{constructor(e){this.providerId=e,this.defaultLanguageCode=null,this.customParameters={}}setDefaultLanguage(e){this.defaultLanguageCode=e}setCustomParameters(e){return this.customParameters=e,this}getCustomParameters(){return this.customParameters}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class gn extends lo{constructor(){super(...arguments),this.scopes=[]}addScope(e){return this.scopes.includes(e)||this.scopes.push(e),this}getScopes(){return[...this.scopes]}}class Hn extends gn{static credentialFromJSON(e){const t=typeof e=="string"?JSON.parse(e):e;return L("providerId"in t&&"signInMethod"in t,"argument-error"),tt._fromParams(t)}credential(e){return this._credential({...e,nonce:e.rawNonce})}_credential(e){return L(e.idToken||e.accessToken,"argument-error"),tt._fromParams({...e,providerId:this.providerId,signInMethod:this.providerId})}static credentialFromResult(e){return Hn.oauthCredentialFromTaggedObject(e)}static credentialFromError(e){return Hn.oauthCredentialFromTaggedObject(e.customData||{})}static oauthCredentialFromTaggedObject({_tokenResponse:e}){if(!e)return null;const{oauthIdToken:t,oauthAccessToken:r,oauthTokenSecret:s,pendingToken:o,nonce:a,providerId:u}=e;if(!r&&!s&&!t&&!o||!u)return null;try{return new Hn(u)._credential({idToken:t,accessToken:r,nonce:a,pendingToken:o})}catch{return null}}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ht extends gn{constructor(){super("facebook.com")}static credential(e){return tt._fromParams({providerId:ht.PROVIDER_ID,signInMethod:ht.FACEBOOK_SIGN_IN_METHOD,accessToken:e})}static credentialFromResult(e){return ht.credentialFromTaggedObject(e)}static credentialFromError(e){return ht.credentialFromTaggedObject(e.customData||{})}static credentialFromTaggedObject({_tokenResponse:e}){if(!e||!("oauthAccessToken"in e)||!e.oauthAccessToken)return null;try{return ht.credential(e.oauthAccessToken)}catch{return null}}}ht.FACEBOOK_SIGN_IN_METHOD="facebook.com";ht.PROVIDER_ID="facebook.com";/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Qe extends gn{constructor(){super("google.com"),this.addScope("profile")}static credential(e,t){return tt._fromParams({providerId:Qe.PROVIDER_ID,signInMethod:Qe.GOOGLE_SIGN_IN_METHOD,idToken:e,accessToken:t})}static credentialFromResult(e){return Qe.credentialFromTaggedObject(e)}static credentialFromError(e){return Qe.credentialFromTaggedObject(e.customData||{})}static credentialFromTaggedObject({_tokenResponse:e}){if(!e)return null;const{oauthIdToken:t,oauthAccessToken:r}=e;if(!t&&!r)return null;try{return Qe.credential(t,r)}catch{return null}}}Qe.GOOGLE_SIGN_IN_METHOD="google.com";Qe.PROVIDER_ID="google.com";/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class dt extends gn{constructor(){super("github.com")}static credential(e){return tt._fromParams({providerId:dt.PROVIDER_ID,signInMethod:dt.GITHUB_SIGN_IN_METHOD,accessToken:e})}static credentialFromResult(e){return dt.credentialFromTaggedObject(e)}static credentialFromError(e){return dt.credentialFromTaggedObject(e.customData||{})}static credentialFromTaggedObject({_tokenResponse:e}){if(!e||!("oauthAccessToken"in e)||!e.oauthAccessToken)return null;try{return dt.credential(e.oauthAccessToken)}catch{return null}}}dt.GITHUB_SIGN_IN_METHOD="github.com";dt.PROVIDER_ID="github.com";/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ft extends gn{constructor(){super("twitter.com")}static credential(e,t){return tt._fromParams({providerId:ft.PROVIDER_ID,signInMethod:ft.TWITTER_SIGN_IN_METHOD,oauthToken:e,oauthTokenSecret:t})}static credentialFromResult(e){return ft.credentialFromTaggedObject(e)}static credentialFromError(e){return ft.credentialFromTaggedObject(e.customData||{})}static credentialFromTaggedObject({_tokenResponse:e}){if(!e)return null;const{oauthAccessToken:t,oauthTokenSecret:r}=e;if(!t||!r)return null;try{return ft.credential(t,r)}catch{return null}}}ft.TWITTER_SIGN_IN_METHOD="twitter.com";ft.PROVIDER_ID="twitter.com";/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class on{constructor(e){this.user=e.user,this.providerId=e.providerId,this._tokenResponse=e._tokenResponse,this.operationType=e.operationType}static async _fromIdTokenResponse(e,t,r,s=!1){const o=await Oe._fromIdTokenResponse(e,r,s),a=gc(r);return new on({user:o,providerId:a,_tokenResponse:r,operationType:t})}static async _forOperation(e,t,r){await e._updateTokensIfNecessary(r,!0);const s=gc(r);return new on({user:e,providerId:s,_tokenResponse:r,operationType:t})}}function gc(n){return n.providerId?n.providerId:"phoneNumber"in n?"phone":null}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class is extends it{constructor(e,t,r,s){super(t.code,t.message),this.operationType=r,this.user=s,Object.setPrototypeOf(this,is.prototype),this.customData={appName:e.name,tenantId:e.tenantId??void 0,_serverResponse:t.customData._serverResponse,operationType:r}}static _fromErrorAndOperation(e,t,r,s){return new is(e,t,r,s)}}function sl(n,e,t,r){return(e==="reauthenticate"?t._getReauthenticationResolver(n):t._getIdTokenResponse(n)).catch(o=>{throw o.code==="auth/multi-factor-auth-required"?is._fromErrorAndOperation(n,o,e,r):o})}async function nm(n,e,t=!1){const r=await Yn(n,e._linkToIdToken(n.auth,await n.getIdToken()),t);return on._forOperation(n,"link",r)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function rm(n,e,t=!1){const{auth:r}=n;if(Ne(r.app))return Promise.reject(xt(r));const s="reauthenticate";try{const o=await Yn(n,sl(r,s,e,n),t);L(o.idToken,r,"internal-error");const a=ao(o.idToken);L(a,r,"internal-error");const{sub:u}=a;return L(n.uid===u,r,"user-mismatch"),on._forOperation(n,s,o)}catch(o){throw o?.code==="auth/user-not-found"&&ze(r,"user-mismatch"),o}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function sm(n,e,t=!1){if(Ne(n.app))return Promise.reject(xt(n));const r="signIn",s=await sl(n,r,e),o=await on._fromIdTokenResponse(n,r,s);return t||await n._updateCurrentUser(o.user),o}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function im(n,e){return ce(n).setPersistence(e)}function om(n,e,t,r){return ce(n).onIdTokenChanged(e,t,r)}function am(n,e,t){return ce(n).beforeAuthStateChanged(e,t)}function LE(n,e,t,r){return ce(n).onAuthStateChanged(e,t,r)}const os="__sak";/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class il{constructor(e,t){this.storageRetriever=e,this.type=t}_isAvailable(){try{return this.storage?(this.storage.setItem(os,"1"),this.storage.removeItem(os),Promise.resolve(!0)):Promise.resolve(!1)}catch{return Promise.resolve(!1)}}_set(e,t){return this.storage.setItem(e,JSON.stringify(t)),Promise.resolve()}_get(e){const t=this.storage.getItem(e);return Promise.resolve(t?JSON.parse(t):null)}_remove(e){return this.storage.removeItem(e),Promise.resolve()}get storage(){return this.storageRetriever()}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const cm=1e3,um=10;class ol extends il{constructor(){super(()=>window.localStorage,"LOCAL"),this.boundEventHandler=(e,t)=>this.onStorageEvent(e,t),this.listeners={},this.localCache={},this.pollTimer=null,this.fallbackToPolling=el(),this._shouldAllowMigration=!0}forAllChangedKeys(e){for(const t of Object.keys(this.listeners)){const r=this.storage.getItem(t),s=this.localCache[t];r!==s&&e(t,s,r)}}onStorageEvent(e,t=!1){if(!e.key){this.forAllChangedKeys((a,u,h)=>{this.notifyListeners(a,h)});return}const r=e.key;t?this.detachListener():this.stopPolling();const s=()=>{const a=this.storage.getItem(r);!t&&this.localCache[r]===a||this.notifyListeners(r,a)},o=this.storage.getItem(r);Bp()&&o!==e.newValue&&e.newValue!==e.oldValue?setTimeout(s,um):s()}notifyListeners(e,t){this.localCache[e]=t;const r=this.listeners[e];if(r)for(const s of Array.from(r))s(t&&JSON.parse(t))}startPolling(){this.stopPolling(),this.pollTimer=setInterval(()=>{this.forAllChangedKeys((e,t,r)=>{this.onStorageEvent(new StorageEvent("storage",{key:e,oldValue:t,newValue:r}),!0)})},cm)}stopPolling(){this.pollTimer&&(clearInterval(this.pollTimer),this.pollTimer=null)}attachListener(){window.addEventListener("storage",this.boundEventHandler)}detachListener(){window.removeEventListener("storage",this.boundEventHandler)}_addListener(e,t){Object.keys(this.listeners).length===0&&(this.fallbackToPolling?this.startPolling():this.attachListener()),this.listeners[e]||(this.listeners[e]=new Set,this.localCache[e]=this.storage.getItem(e)),this.listeners[e].add(t)}_removeListener(e,t){this.listeners[e]&&(this.listeners[e].delete(t),this.listeners[e].size===0&&delete this.listeners[e]),Object.keys(this.listeners).length===0&&(this.detachListener(),this.stopPolling())}async _set(e,t){await super._set(e,t),this.localCache[e]=JSON.stringify(t)}async _get(e){const t=await super._get(e);return this.localCache[e]=JSON.stringify(t),t}async _remove(e){await super._remove(e),delete this.localCache[e]}}ol.type="LOCAL";const al=ol;/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class cl extends il{constructor(){super(()=>window.sessionStorage,"SESSION")}_addListener(e,t){}_removeListener(e,t){}}cl.type="SESSION";const ul=cl;/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function lm(n){return Promise.all(n.map(async e=>{try{return{fulfilled:!0,value:await e}}catch(t){return{fulfilled:!1,reason:t}}}))}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Is{constructor(e){this.eventTarget=e,this.handlersMap={},this.boundEventHandler=this.handleEvent.bind(this)}static _getInstance(e){const t=this.receivers.find(s=>s.isListeningto(e));if(t)return t;const r=new Is(e);return this.receivers.push(r),r}isListeningto(e){return this.eventTarget===e}async handleEvent(e){const t=e,{eventId:r,eventType:s,data:o}=t.data,a=this.handlersMap[s];if(!a?.size)return;t.ports[0].postMessage({status:"ack",eventId:r,eventType:s});const u=Array.from(a).map(async d=>d(t.origin,o)),h=await lm(u);t.ports[0].postMessage({status:"done",eventId:r,eventType:s,response:h})}_subscribe(e,t){Object.keys(this.handlersMap).length===0&&this.eventTarget.addEventListener("message",this.boundEventHandler),this.handlersMap[e]||(this.handlersMap[e]=new Set),this.handlersMap[e].add(t)}_unsubscribe(e,t){this.handlersMap[e]&&t&&this.handlersMap[e].delete(t),(!t||this.handlersMap[e].size===0)&&delete this.handlersMap[e],Object.keys(this.handlersMap).length===0&&this.eventTarget.removeEventListener("message",this.boundEventHandler)}}Is.receivers=[];/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function ho(n="",e=10){let t="";for(let r=0;r<e;r++)t+=Math.floor(Math.random()*10);return n+t}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class hm{constructor(e){this.target=e,this.handlers=new Set}removeMessageHandler(e){e.messageChannel&&(e.messageChannel.port1.removeEventListener("message",e.onMessage),e.messageChannel.port1.close()),this.handlers.delete(e)}async _send(e,t,r=50){const s=typeof MessageChannel<"u"?new MessageChannel:null;if(!s)throw new Error("connection_unavailable");let o,a;return new Promise((u,h)=>{const d=ho("",20);s.port1.start();const p=setTimeout(()=>{h(new Error("unsupported_event"))},r);a={messageChannel:s,onMessage(y){const E=y;if(E.data.eventId===d)switch(E.data.status){case"ack":clearTimeout(p),o=setTimeout(()=>{h(new Error("timeout"))},3e3);break;case"done":clearTimeout(o),u(E.data.response);break;default:clearTimeout(p),clearTimeout(o),h(new Error("invalid_response"));break}}},this.handlers.add(a),s.port1.addEventListener("message",a.onMessage),this.target.postMessage({eventType:e,eventId:d,data:t},[s.port2])}).finally(()=>{a&&this.removeMessageHandler(a)})}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Ue(){return window}function dm(n){Ue().location.href=n}/**
 * @license
 * Copyright 2020 Google LLC.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function ll(){return typeof Ue().WorkerGlobalScope<"u"&&typeof Ue().importScripts=="function"}async function fm(){if(!navigator?.serviceWorker)return null;try{return(await navigator.serviceWorker.ready).active}catch{return null}}function pm(){return navigator?.serviceWorker?.controller||null}function mm(){return ll()?self:null}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const hl="firebaseLocalStorageDb",gm=1,as="firebaseLocalStorage",dl="fbase_key";class lr{constructor(e){this.request=e}toPromise(){return new Promise((e,t)=>{this.request.addEventListener("success",()=>{e(this.request.result)}),this.request.addEventListener("error",()=>{t(this.request.error)})})}}function vs(n,e){return n.transaction([as],e?"readwrite":"readonly").objectStore(as)}function _m(){const n=indexedDB.deleteDatabase(hl);return new lr(n).toPromise()}function Mi(){const n=indexedDB.open(hl,gm);return new Promise((e,t)=>{n.addEventListener("error",()=>{t(n.error)}),n.addEventListener("upgradeneeded",()=>{const r=n.result;try{r.createObjectStore(as,{keyPath:dl})}catch(s){t(s)}}),n.addEventListener("success",async()=>{const r=n.result;r.objectStoreNames.contains(as)?e(r):(r.close(),await _m(),e(await Mi()))})})}async function _c(n,e,t){const r=vs(n,!0).put({[dl]:e,value:t});return new lr(r).toPromise()}async function ym(n,e){const t=vs(n,!1).get(e),r=await new lr(t).toPromise();return r===void 0?null:r.value}function yc(n,e){const t=vs(n,!0).delete(e);return new lr(t).toPromise()}const Em=800,Tm=3;class fl{constructor(){this.type="LOCAL",this._shouldAllowMigration=!0,this.listeners={},this.localCache={},this.pollTimer=null,this.pendingWrites=0,this.receiver=null,this.sender=null,this.serviceWorkerReceiverAvailable=!1,this.activeServiceWorker=null,this._workerInitializationPromise=this.initializeServiceWorkerMessaging().then(()=>{},()=>{})}async _openDb(){return this.db?this.db:(this.db=await Mi(),this.db)}async _withRetries(e){let t=0;for(;;)try{const r=await this._openDb();return await e(r)}catch(r){if(t++>Tm)throw r;this.db&&(this.db.close(),this.db=void 0)}}async initializeServiceWorkerMessaging(){return ll()?this.initializeReceiver():this.initializeSender()}async initializeReceiver(){this.receiver=Is._getInstance(mm()),this.receiver._subscribe("keyChanged",async(e,t)=>({keyProcessed:(await this._poll()).includes(t.key)})),this.receiver._subscribe("ping",async(e,t)=>["keyChanged"])}async initializeSender(){if(this.activeServiceWorker=await fm(),!this.activeServiceWorker)return;this.sender=new hm(this.activeServiceWorker);const e=await this.sender._send("ping",{},800);e&&e[0]?.fulfilled&&e[0]?.value.includes("keyChanged")&&(this.serviceWorkerReceiverAvailable=!0)}async notifyServiceWorker(e){if(!(!this.sender||!this.activeServiceWorker||pm()!==this.activeServiceWorker))try{await this.sender._send("keyChanged",{key:e},this.serviceWorkerReceiverAvailable?800:50)}catch{}}async _isAvailable(){try{if(!indexedDB)return!1;const e=await Mi();return await _c(e,os,"1"),await yc(e,os),!0}catch{}return!1}async _withPendingWrite(e){this.pendingWrites++;try{await e()}finally{this.pendingWrites--}}async _set(e,t){return this._withPendingWrite(async()=>(await this._withRetries(r=>_c(r,e,t)),this.localCache[e]=t,this.notifyServiceWorker(e)))}async _get(e){const t=await this._withRetries(r=>ym(r,e));return this.localCache[e]=t,t}async _remove(e){return this._withPendingWrite(async()=>(await this._withRetries(t=>yc(t,e)),delete this.localCache[e],this.notifyServiceWorker(e)))}async _poll(){const e=await this._withRetries(s=>{const o=vs(s,!1).getAll();return new lr(o).toPromise()});if(!e)return[];if(this.pendingWrites!==0)return[];const t=[],r=new Set;if(e.length!==0)for(const{fbase_key:s,value:o}of e)r.add(s),JSON.stringify(this.localCache[s])!==JSON.stringify(o)&&(this.notifyListeners(s,o),t.push(s));for(const s of Object.keys(this.localCache))this.localCache[s]&&!r.has(s)&&(this.notifyListeners(s,null),t.push(s));return t}notifyListeners(e,t){this.localCache[e]=t;const r=this.listeners[e];if(r)for(const s of Array.from(r))s(t)}startPolling(){this.stopPolling(),this.pollTimer=setInterval(async()=>this._poll(),Em)}stopPolling(){this.pollTimer&&(clearInterval(this.pollTimer),this.pollTimer=null)}_addListener(e,t){Object.keys(this.listeners).length===0&&this.startPolling(),this.listeners[e]||(this.listeners[e]=new Set,this._get(e)),this.listeners[e].add(t)}_removeListener(e,t){this.listeners[e]&&(this.listeners[e].delete(t),this.listeners[e].size===0&&delete this.listeners[e]),Object.keys(this.listeners).length===0&&this.stopPolling()}}fl.type="LOCAL";const Im=fl;new ur(3e4,6e4);/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function pl(n,e){return e?Xe(e):(L(n._popupRedirectResolver,n,"argument-error"),n._popupRedirectResolver)}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class fo extends rl{constructor(e){super("custom","custom"),this.params=e}_getIdTokenResponse(e){return nn(e,this._buildIdpRequest())}_linkToIdToken(e,t){return nn(e,this._buildIdpRequest(t))}_getReauthenticationResolver(e){return nn(e,this._buildIdpRequest())}_buildIdpRequest(e){const t={requestUri:this.params.requestUri,sessionId:this.params.sessionId,postBody:this.params.postBody,tenantId:this.params.tenantId,pendingToken:this.params.pendingToken,returnSecureToken:!0,returnIdpCredential:!0};return e&&(t.idToken=e),t}}function vm(n){return sm(n.auth,new fo(n),n.bypassAuthState)}function wm(n){const{auth:e,user:t}=n;return L(t,e,"internal-error"),rm(t,new fo(n),n.bypassAuthState)}async function Am(n){const{auth:e,user:t}=n;return L(t,e,"internal-error"),nm(t,new fo(n),n.bypassAuthState)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ml{constructor(e,t,r,s,o=!1){this.auth=e,this.resolver=r,this.user=s,this.bypassAuthState=o,this.pendingPromise=null,this.eventManager=null,this.filter=Array.isArray(t)?t:[t]}execute(){return new Promise(async(e,t)=>{this.pendingPromise={resolve:e,reject:t};try{this.eventManager=await this.resolver._initialize(this.auth),await this.onExecution(),this.eventManager.registerConsumer(this)}catch(r){this.reject(r)}})}async onAuthEvent(e){const{urlResponse:t,sessionId:r,postBody:s,tenantId:o,error:a,type:u}=e;if(a){this.reject(a);return}const h={auth:this.auth,requestUri:t,sessionId:r,tenantId:o||void 0,postBody:s||void 0,user:this.user,bypassAuthState:this.bypassAuthState};try{this.resolve(await this.getIdpTask(u)(h))}catch(d){this.reject(d)}}onError(e){this.reject(e)}getIdpTask(e){switch(e){case"signInViaPopup":case"signInViaRedirect":return vm;case"linkViaPopup":case"linkViaRedirect":return Am;case"reauthViaPopup":case"reauthViaRedirect":return wm;default:ze(this.auth,"internal-error")}}resolve(e){et(this.pendingPromise,"Pending promise was never set"),this.pendingPromise.resolve(e),this.unregisterAndCleanUp()}reject(e){et(this.pendingPromise,"Pending promise was never set"),this.pendingPromise.reject(e),this.unregisterAndCleanUp()}unregisterAndCleanUp(){this.eventManager&&this.eventManager.unregisterConsumer(this),this.pendingPromise=null,this.cleanUp()}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Rm=new ur(2e3,1e4);async function gl(n,e,t){if(Ne(n.app))return Promise.reject(Me(n,"operation-not-supported-in-this-environment"));const r=Ts(n);vp(n,e,lo);const s=pl(r,t);return new Mt(r,"signInViaPopup",e,s).executeNotNull()}class Mt extends ml{constructor(e,t,r,s,o){super(e,t,s,o),this.provider=r,this.authWindow=null,this.pollId=null,Mt.currentPopupAction&&Mt.currentPopupAction.cancel(),Mt.currentPopupAction=this}async executeNotNull(){const e=await this.execute();return L(e,this.auth,"internal-error"),e}async onExecution(){et(this.filter.length===1,"Popup operations only handle one event");const e=ho();this.authWindow=await this.resolver._openPopup(this.auth,this.provider,this.filter[0],e),this.authWindow.associatedEvent=e,this.resolver._originValidation(this.auth).catch(t=>{this.reject(t)}),this.resolver._isIframeWebStorageSupported(this.auth,t=>{t||this.reject(Me(this.auth,"web-storage-unsupported"))}),this.pollUserCancellation()}get eventId(){return this.authWindow?.associatedEvent||null}cancel(){this.reject(Me(this.auth,"cancelled-popup-request"))}cleanUp(){this.authWindow&&this.authWindow.close(),this.pollId&&window.clearTimeout(this.pollId),this.authWindow=null,this.pollId=null,Mt.currentPopupAction=null}pollUserCancellation(){const e=()=>{if(this.authWindow?.window?.closed){this.pollId=window.setTimeout(()=>{this.pollId=null,this.reject(Me(this.auth,"popup-closed-by-user"))},8e3);return}this.pollId=window.setTimeout(e,Rm.get())};e()}}Mt.currentPopupAction=null;/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Sm="pendingRedirect",Wr=new Map;class Pm extends ml{constructor(e,t,r=!1){super(e,["signInViaRedirect","linkViaRedirect","reauthViaRedirect","unknown"],t,void 0,r),this.eventId=null}async execute(){let e=Wr.get(this.auth._key());if(!e){try{const r=await Cm(this.resolver,this.auth)?await super.execute():null;e=()=>Promise.resolve(r)}catch(t){e=()=>Promise.reject(t)}Wr.set(this.auth._key(),e)}return this.bypassAuthState||Wr.set(this.auth._key(),()=>Promise.resolve(null)),e()}async onAuthEvent(e){if(e.type==="signInViaRedirect")return super.onAuthEvent(e);if(e.type==="unknown"){this.resolve(null);return}if(e.eventId){const t=await this.auth._redirectUserForId(e.eventId);if(t)return this.user=t,super.onAuthEvent(e);this.resolve(null)}}async onExecution(){}cleanUp(){}}async function Cm(n,e){const t=km(e),r=Vm(n);if(!await r._isAvailable())return!1;const s=await r._get(t)==="true";return await r._remove(t),s}function bm(n,e){Wr.set(n._key(),e)}function Vm(n){return Xe(n._redirectPersistence)}function km(n){return Gr(Sm,n.config.apiKey,n.name)}async function Dm(n,e,t=!1){if(Ne(n.app))return Promise.reject(xt(n));const r=Ts(n),s=pl(r,e),a=await new Pm(r,s,t).execute();return a&&!t&&(delete a.user._redirectEventId,await r._persistUserIfCurrent(a.user),await r._setRedirectUser(null,e)),a}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Nm=600*1e3;class Om{constructor(e){this.auth=e,this.cachedEventUids=new Set,this.consumers=new Set,this.queuedRedirectEvent=null,this.hasHandledPotentialRedirect=!1,this.lastProcessedEventTime=Date.now()}registerConsumer(e){this.consumers.add(e),this.queuedRedirectEvent&&this.isEventForConsumer(this.queuedRedirectEvent,e)&&(this.sendToConsumer(this.queuedRedirectEvent,e),this.saveEventToCache(this.queuedRedirectEvent),this.queuedRedirectEvent=null)}unregisterConsumer(e){this.consumers.delete(e)}onEvent(e){if(this.hasEventBeenHandled(e))return!1;let t=!1;return this.consumers.forEach(r=>{this.isEventForConsumer(e,r)&&(t=!0,this.sendToConsumer(e,r),this.saveEventToCache(e))}),this.hasHandledPotentialRedirect||!Mm(e)||(this.hasHandledPotentialRedirect=!0,t||(this.queuedRedirectEvent=e,t=!0)),t}sendToConsumer(e,t){if(e.error&&!_l(e)){const r=e.error.code?.split("auth/")[1]||"internal-error";t.onError(Me(this.auth,r))}else t.onAuthEvent(e)}isEventForConsumer(e,t){const r=t.eventId===null||!!e.eventId&&e.eventId===t.eventId;return t.filter.includes(e.type)&&r}hasEventBeenHandled(e){return Date.now()-this.lastProcessedEventTime>=Nm&&this.cachedEventUids.clear(),this.cachedEventUids.has(Ec(e))}saveEventToCache(e){this.cachedEventUids.add(Ec(e)),this.lastProcessedEventTime=Date.now()}}function Ec(n){return[n.type,n.eventId,n.sessionId,n.tenantId].filter(e=>e).join("-")}function _l({type:n,error:e}){return n==="unknown"&&e?.code==="auth/no-auth-event"}function Mm(n){switch(n.type){case"signInViaRedirect":case"linkViaRedirect":case"reauthViaRedirect":return!0;case"unknown":return _l(n);default:return!1}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function Lm(n,e={}){return mn(n,"GET","/v1/projects",e)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const xm=/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,Fm=/^https?/;async function Um(n){if(n.config.emulator)return;const{authorizedDomains:e}=await Lm(n);for(const t of e)try{if(Bm(t))return}catch{}ze(n,"unauthorized-domain")}function Bm(n){const e=Ni(),{protocol:t,hostname:r}=new URL(e);if(n.startsWith("chrome-extension://")){const a=new URL(n);return a.hostname===""&&r===""?t==="chrome-extension:"&&n.replace("chrome-extension://","")===e.replace("chrome-extension://",""):t==="chrome-extension:"&&a.hostname===r}if(!Fm.test(t))return!1;if(xm.test(n))return r===n;const s=n.replace(/\./g,"\\.");return new RegExp("^(.+\\."+s+"|"+s+")$","i").test(r)}/**
 * @license
 * Copyright 2020 Google LLC.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const jm=new ur(3e4,6e4);function Tc(){const n=Ue().___jsl;if(n?.H){for(const e of Object.keys(n.H))if(n.H[e].r=n.H[e].r||[],n.H[e].L=n.H[e].L||[],n.H[e].r=[...n.H[e].L],n.CP)for(let t=0;t<n.CP.length;t++)n.CP[t]=null}}function qm(n){return new Promise((e,t)=>{function r(){Tc(),gapi.load("gapi.iframes",{callback:()=>{e(gapi.iframes.getContext())},ontimeout:()=>{Tc(),t(Me(n,"network-request-failed"))},timeout:jm.get()})}if(Ue().gapi?.iframes?.Iframe)e(gapi.iframes.getContext());else if(Ue().gapi?.load)r();else{const s=Qp("iframefcb");return Ue()[s]=()=>{gapi.load?r():t(Me(n,"network-request-failed"))},Wp(`${Kp()}?onload=${s}`).catch(o=>t(o))}}).catch(e=>{throw Kr=null,e})}let Kr=null;function $m(n){return Kr=Kr||qm(n),Kr}/**
 * @license
 * Copyright 2020 Google LLC.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const zm=new ur(5e3,15e3),Hm="__/auth/iframe",Gm="emulator/auth/iframe",Wm={style:{position:"absolute",top:"-100px",width:"1px",height:"1px"},"aria-hidden":"true",tabindex:"-1"},Km=new Map([["identitytoolkit.googleapis.com","p"],["staging-identitytoolkit.sandbox.googleapis.com","s"],["test-identitytoolkit.sandbox.googleapis.com","t"]]);function Qm(n){const e=n.config;L(e.authDomain,n,"auth-domain-config-required");const t=e.emulator?io(e,Gm):`https://${n.config.authDomain}/${Hm}`,r={apiKey:e.apiKey,appName:n.name,v:pn},s=Km.get(n.config.apiHost);s&&(r.eid=s);const o=n._getFrameworks();return o.length&&(r.fw=o.join(",")),`${t}?${cr(r).slice(1)}`}async function Jm(n){const e=await $m(n),t=Ue().gapi;return L(t,n,"internal-error"),e.open({where:document.body,url:Qm(n),messageHandlersFilter:t.iframes.CROSS_ORIGIN_IFRAMES_FILTER,attributes:Wm,dontclear:!0},r=>new Promise(async(s,o)=>{await r.restyle({setHideOnLeave:!1});const a=Me(n,"network-request-failed"),u=Ue().setTimeout(()=>{o(a)},zm.get());function h(){Ue().clearTimeout(u),s(r)}r.ping(h).then(h,()=>{o(a)})}))}/**
 * @license
 * Copyright 2020 Google LLC.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Xm={location:"yes",resizable:"yes",statusbar:"yes",toolbar:"no"},Ym=500,Zm=600,eg="_blank",tg="http://localhost";class Ic{constructor(e){this.window=e,this.associatedEvent=null}close(){if(this.window)try{this.window.close()}catch{}}}function ng(n,e,t,r=Ym,s=Zm){const o=Math.max((window.screen.availHeight-s)/2,0).toString(),a=Math.max((window.screen.availWidth-r)/2,0).toString();let u="";const h={...Xm,width:r.toString(),height:s.toString(),top:o,left:a},d=ve().toLowerCase();t&&(u=Qu(d)?eg:t),Wu(d)&&(e=e||tg,h.scrollbars="yes");const p=Object.entries(h).reduce((E,[C,b])=>`${E}${C}=${b},`,"");if(Up(d)&&u!=="_self")return rg(e||"",u),new Ic(null);const y=window.open(e||"",u,p);L(y,n,"popup-blocked");try{y.focus()}catch{}return new Ic(y)}function rg(n,e){const t=document.createElement("a");t.href=n,t.target=e;const r=document.createEvent("MouseEvent");r.initMouseEvent("click",!0,!0,window,1,0,0,0,0,!1,!1,!1,!1,1,null),t.dispatchEvent(r)}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const sg="__/auth/handler",ig="emulator/auth/handler",og=encodeURIComponent("fac");async function vc(n,e,t,r,s,o){L(n.config.authDomain,n,"auth-domain-config-required"),L(n.config.apiKey,n,"invalid-api-key");const a={apiKey:n.config.apiKey,appName:n.name,authType:t,redirectUrl:r,v:pn,eventId:s};if(e instanceof lo){e.setDefaultLanguage(n.languageCode),a.providerId=e.providerId||"",of(e.getCustomParameters())||(a.customParameters=JSON.stringify(e.getCustomParameters()));for(const[p,y]of Object.entries({}))a[p]=y}if(e instanceof gn){const p=e.getScopes().filter(y=>y!=="");p.length>0&&(a.scopes=p.join(","))}n.tenantId&&(a.tid=n.tenantId);const u=a;for(const p of Object.keys(u))u[p]===void 0&&delete u[p];const h=await n._getAppCheckToken(),d=h?`#${og}=${encodeURIComponent(h)}`:"";return`${ag(n)}?${cr(u).slice(1)}${d}`}function ag({config:n}){return n.emulator?io(n,ig):`https://${n.authDomain}/${sg}`}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Ii="webStorageSupport";class cg{constructor(){this.eventManagers={},this.iframes={},this.originValidationPromises={},this._redirectPersistence=ul,this._completeRedirectFn=Dm,this._overrideRedirectResult=bm}async _openPopup(e,t,r,s){et(this.eventManagers[e._key()]?.manager,"_initialize() not called before _openPopup()");const o=await vc(e,t,r,Ni(),s);return ng(e,o,ho())}async _openRedirect(e,t,r,s){await this._originValidation(e);const o=await vc(e,t,r,Ni(),s);return dm(o),new Promise(()=>{})}_initialize(e){const t=e._key();if(this.eventManagers[t]){const{manager:s,promise:o}=this.eventManagers[t];return s?Promise.resolve(s):(et(o,"If manager is not set, promise should be"),o)}const r=this.initAndGetManager(e);return this.eventManagers[t]={promise:r},r.catch(()=>{delete this.eventManagers[t]}),r}async initAndGetManager(e){const t=await Jm(e),r=new Om(e);return t.register("authEvent",s=>(L(s?.authEvent,e,"invalid-auth-event"),{status:r.onEvent(s.authEvent)?"ACK":"ERROR"}),gapi.iframes.CROSS_ORIGIN_IFRAMES_FILTER),this.eventManagers[e._key()]={manager:r},this.iframes[e._key()]=t,r}_isIframeWebStorageSupported(e,t){this.iframes[e._key()].send(Ii,{type:Ii},s=>{const o=s?.[0]?.[Ii];o!==void 0&&t(!!o),ze(e,"internal-error")},gapi.iframes.CROSS_ORIGIN_IFRAMES_FILTER)}_originValidation(e){const t=e._key();return this.originValidationPromises[t]||(this.originValidationPromises[t]=Um(e)),this.originValidationPromises[t]}get _shouldInitProactively(){return el()||Ku()||co()}}const ug=cg;var wc="@firebase/auth",Ac="1.11.0";/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class lg{constructor(e){this.auth=e,this.internalListeners=new Map}getUid(){return this.assertAuthConfigured(),this.auth.currentUser?.uid||null}async getToken(e){return this.assertAuthConfigured(),await this.auth._initializationPromise,this.auth.currentUser?{accessToken:await this.auth.currentUser.getIdToken(e)}:null}addAuthTokenListener(e){if(this.assertAuthConfigured(),this.internalListeners.has(e))return;const t=this.auth.onIdTokenChanged(r=>{e(r?.stsTokenManager.accessToken||null)});this.internalListeners.set(e,t),this.updateProactiveRefresh()}removeAuthTokenListener(e){this.assertAuthConfigured();const t=this.internalListeners.get(e);t&&(this.internalListeners.delete(e),t(),this.updateProactiveRefresh())}assertAuthConfigured(){L(this.auth._initializationPromise,"dependent-sdk-initialized-before-auth")}updateProactiveRefresh(){this.internalListeners.size>0?this.auth._startProactiveRefresh():this.auth._stopProactiveRefresh()}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function hg(n){switch(n){case"Node":return"node";case"ReactNative":return"rn";case"Worker":return"webworker";case"Cordova":return"cordova";case"WebExtension":return"web-extension";default:return}}function dg(n){sn(new jt("auth",(e,{options:t})=>{const r=e.getProvider("app").getImmediate(),s=e.getProvider("heartbeat"),o=e.getProvider("app-check-internal"),{apiKey:a,authDomain:u}=r.options;L(a&&!a.includes(":"),"invalid-api-key",{appName:r.name});const h={apiKey:a,authDomain:u,clientPlatform:n,apiHost:"identitytoolkit.googleapis.com",tokenApiHost:"securetoken.googleapis.com",apiScheme:"https",sdkClientVersion:tl(n)},d=new Hp(r,s,o,h);return Xp(d,t),d},"PUBLIC").setInstantiationMode("EXPLICIT").setInstanceCreatedCallback((e,t,r)=>{e.getProvider("auth-internal").initialize()})),sn(new jt("auth-internal",e=>{const t=Ts(e.getProvider("auth").getImmediate());return(r=>new lg(r))(t)},"PRIVATE").setInstantiationMode("EXPLICIT")),_t(wc,Ac,hg(n)),_t(wc,Ac,"esm2020")}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const fg=300,pg=ku("authIdTokenMaxAge")||fg;let Rc=null;const mg=n=>async e=>{const t=e&&await e.getIdTokenResult(),r=t&&(new Date().getTime()-Date.parse(t.issuedAtTime))/1e3;if(r&&r>pg)return;const s=t?.token;Rc!==s&&(Rc=s,await fetch(n,{method:s?"POST":"DELETE",headers:s?{Authorization:`Bearer ${s}`}:{}}))};function gg(n=xu()){const e=no(n,"auth");if(e.isInitialized())return e.getImmediate();const t=Jp(n,{popupRedirectResolver:ug,persistence:[Im,al,ul]}),r=ku("authTokenSyncURL");if(r&&typeof isSecureContext=="boolean"&&isSecureContext){const o=new URL(r,location.origin);if(location.origin===o.origin){const a=mg(o.toString());am(t,a,()=>a(t.currentUser)),om(t,u=>a(u))}}const s=bu("auth");return s&&Yp(t,`http://${s}`),t}function _g(){return document.getElementsByTagName("head")?.[0]??document}Gp({loadJS(n){return new Promise((e,t)=>{const r=document.createElement("script");r.setAttribute("src",n),r.onload=e,r.onerror=s=>{const o=Me("internal-error");o.customData=s,t(o)},r.type="text/javascript",r.charset="UTF-8",_g().appendChild(r)})},gapiScript:"https://apis.google.com/js/api.js",recaptchaV2Script:"https://www.google.com/recaptcha/api.js",recaptchaEnterpriseScript:"https://www.google.com/recaptcha/enterprise.js?render="});dg("Browser");var Sc=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof global<"u"?global:typeof self<"u"?self:{};/** @license
Copyright The Closure Library Authors.
SPDX-License-Identifier: Apache-2.0
*/var yt,yl;(function(){var n;/** @license

 Copyright The Closure Library Authors.
 SPDX-License-Identifier: Apache-2.0
*/function e(v,m){function _(){}_.prototype=m.prototype,v.D=m.prototype,v.prototype=new _,v.prototype.constructor=v,v.C=function(T,I,A){for(var g=Array(arguments.length-2),Ge=2;Ge<arguments.length;Ge++)g[Ge-2]=arguments[Ge];return m.prototype[I].apply(T,g)}}function t(){this.blockSize=-1}function r(){this.blockSize=-1,this.blockSize=64,this.g=Array(4),this.B=Array(this.blockSize),this.o=this.h=0,this.s()}e(r,t),r.prototype.s=function(){this.g[0]=1732584193,this.g[1]=4023233417,this.g[2]=2562383102,this.g[3]=271733878,this.o=this.h=0};function s(v,m,_){_||(_=0);var T=Array(16);if(typeof m=="string")for(var I=0;16>I;++I)T[I]=m.charCodeAt(_++)|m.charCodeAt(_++)<<8|m.charCodeAt(_++)<<16|m.charCodeAt(_++)<<24;else for(I=0;16>I;++I)T[I]=m[_++]|m[_++]<<8|m[_++]<<16|m[_++]<<24;m=v.g[0],_=v.g[1],I=v.g[2];var A=v.g[3],g=m+(A^_&(I^A))+T[0]+3614090360&4294967295;m=_+(g<<7&4294967295|g>>>25),g=A+(I^m&(_^I))+T[1]+3905402710&4294967295,A=m+(g<<12&4294967295|g>>>20),g=I+(_^A&(m^_))+T[2]+606105819&4294967295,I=A+(g<<17&4294967295|g>>>15),g=_+(m^I&(A^m))+T[3]+3250441966&4294967295,_=I+(g<<22&4294967295|g>>>10),g=m+(A^_&(I^A))+T[4]+4118548399&4294967295,m=_+(g<<7&4294967295|g>>>25),g=A+(I^m&(_^I))+T[5]+1200080426&4294967295,A=m+(g<<12&4294967295|g>>>20),g=I+(_^A&(m^_))+T[6]+2821735955&4294967295,I=A+(g<<17&4294967295|g>>>15),g=_+(m^I&(A^m))+T[7]+4249261313&4294967295,_=I+(g<<22&4294967295|g>>>10),g=m+(A^_&(I^A))+T[8]+1770035416&4294967295,m=_+(g<<7&4294967295|g>>>25),g=A+(I^m&(_^I))+T[9]+2336552879&4294967295,A=m+(g<<12&4294967295|g>>>20),g=I+(_^A&(m^_))+T[10]+4294925233&4294967295,I=A+(g<<17&4294967295|g>>>15),g=_+(m^I&(A^m))+T[11]+2304563134&4294967295,_=I+(g<<22&4294967295|g>>>10),g=m+(A^_&(I^A))+T[12]+1804603682&4294967295,m=_+(g<<7&4294967295|g>>>25),g=A+(I^m&(_^I))+T[13]+4254626195&4294967295,A=m+(g<<12&4294967295|g>>>20),g=I+(_^A&(m^_))+T[14]+2792965006&4294967295,I=A+(g<<17&4294967295|g>>>15),g=_+(m^I&(A^m))+T[15]+1236535329&4294967295,_=I+(g<<22&4294967295|g>>>10),g=m+(I^A&(_^I))+T[1]+4129170786&4294967295,m=_+(g<<5&4294967295|g>>>27),g=A+(_^I&(m^_))+T[6]+3225465664&4294967295,A=m+(g<<9&4294967295|g>>>23),g=I+(m^_&(A^m))+T[11]+643717713&4294967295,I=A+(g<<14&4294967295|g>>>18),g=_+(A^m&(I^A))+T[0]+3921069994&4294967295,_=I+(g<<20&4294967295|g>>>12),g=m+(I^A&(_^I))+T[5]+3593408605&4294967295,m=_+(g<<5&4294967295|g>>>27),g=A+(_^I&(m^_))+T[10]+38016083&4294967295,A=m+(g<<9&4294967295|g>>>23),g=I+(m^_&(A^m))+T[15]+3634488961&4294967295,I=A+(g<<14&4294967295|g>>>18),g=_+(A^m&(I^A))+T[4]+3889429448&4294967295,_=I+(g<<20&4294967295|g>>>12),g=m+(I^A&(_^I))+T[9]+568446438&4294967295,m=_+(g<<5&4294967295|g>>>27),g=A+(_^I&(m^_))+T[14]+3275163606&4294967295,A=m+(g<<9&4294967295|g>>>23),g=I+(m^_&(A^m))+T[3]+4107603335&4294967295,I=A+(g<<14&4294967295|g>>>18),g=_+(A^m&(I^A))+T[8]+1163531501&4294967295,_=I+(g<<20&4294967295|g>>>12),g=m+(I^A&(_^I))+T[13]+2850285829&4294967295,m=_+(g<<5&4294967295|g>>>27),g=A+(_^I&(m^_))+T[2]+4243563512&4294967295,A=m+(g<<9&4294967295|g>>>23),g=I+(m^_&(A^m))+T[7]+1735328473&4294967295,I=A+(g<<14&4294967295|g>>>18),g=_+(A^m&(I^A))+T[12]+2368359562&4294967295,_=I+(g<<20&4294967295|g>>>12),g=m+(_^I^A)+T[5]+4294588738&4294967295,m=_+(g<<4&4294967295|g>>>28),g=A+(m^_^I)+T[8]+2272392833&4294967295,A=m+(g<<11&4294967295|g>>>21),g=I+(A^m^_)+T[11]+1839030562&4294967295,I=A+(g<<16&4294967295|g>>>16),g=_+(I^A^m)+T[14]+4259657740&4294967295,_=I+(g<<23&4294967295|g>>>9),g=m+(_^I^A)+T[1]+2763975236&4294967295,m=_+(g<<4&4294967295|g>>>28),g=A+(m^_^I)+T[4]+1272893353&4294967295,A=m+(g<<11&4294967295|g>>>21),g=I+(A^m^_)+T[7]+4139469664&4294967295,I=A+(g<<16&4294967295|g>>>16),g=_+(I^A^m)+T[10]+3200236656&4294967295,_=I+(g<<23&4294967295|g>>>9),g=m+(_^I^A)+T[13]+681279174&4294967295,m=_+(g<<4&4294967295|g>>>28),g=A+(m^_^I)+T[0]+3936430074&4294967295,A=m+(g<<11&4294967295|g>>>21),g=I+(A^m^_)+T[3]+3572445317&4294967295,I=A+(g<<16&4294967295|g>>>16),g=_+(I^A^m)+T[6]+76029189&4294967295,_=I+(g<<23&4294967295|g>>>9),g=m+(_^I^A)+T[9]+3654602809&4294967295,m=_+(g<<4&4294967295|g>>>28),g=A+(m^_^I)+T[12]+3873151461&4294967295,A=m+(g<<11&4294967295|g>>>21),g=I+(A^m^_)+T[15]+530742520&4294967295,I=A+(g<<16&4294967295|g>>>16),g=_+(I^A^m)+T[2]+3299628645&4294967295,_=I+(g<<23&4294967295|g>>>9),g=m+(I^(_|~A))+T[0]+4096336452&4294967295,m=_+(g<<6&4294967295|g>>>26),g=A+(_^(m|~I))+T[7]+1126891415&4294967295,A=m+(g<<10&4294967295|g>>>22),g=I+(m^(A|~_))+T[14]+2878612391&4294967295,I=A+(g<<15&4294967295|g>>>17),g=_+(A^(I|~m))+T[5]+4237533241&4294967295,_=I+(g<<21&4294967295|g>>>11),g=m+(I^(_|~A))+T[12]+1700485571&4294967295,m=_+(g<<6&4294967295|g>>>26),g=A+(_^(m|~I))+T[3]+2399980690&4294967295,A=m+(g<<10&4294967295|g>>>22),g=I+(m^(A|~_))+T[10]+4293915773&4294967295,I=A+(g<<15&4294967295|g>>>17),g=_+(A^(I|~m))+T[1]+2240044497&4294967295,_=I+(g<<21&4294967295|g>>>11),g=m+(I^(_|~A))+T[8]+1873313359&4294967295,m=_+(g<<6&4294967295|g>>>26),g=A+(_^(m|~I))+T[15]+4264355552&4294967295,A=m+(g<<10&4294967295|g>>>22),g=I+(m^(A|~_))+T[6]+2734768916&4294967295,I=A+(g<<15&4294967295|g>>>17),g=_+(A^(I|~m))+T[13]+1309151649&4294967295,_=I+(g<<21&4294967295|g>>>11),g=m+(I^(_|~A))+T[4]+4149444226&4294967295,m=_+(g<<6&4294967295|g>>>26),g=A+(_^(m|~I))+T[11]+3174756917&4294967295,A=m+(g<<10&4294967295|g>>>22),g=I+(m^(A|~_))+T[2]+718787259&4294967295,I=A+(g<<15&4294967295|g>>>17),g=_+(A^(I|~m))+T[9]+3951481745&4294967295,v.g[0]=v.g[0]+m&4294967295,v.g[1]=v.g[1]+(I+(g<<21&4294967295|g>>>11))&4294967295,v.g[2]=v.g[2]+I&4294967295,v.g[3]=v.g[3]+A&4294967295}r.prototype.u=function(v,m){m===void 0&&(m=v.length);for(var _=m-this.blockSize,T=this.B,I=this.h,A=0;A<m;){if(I==0)for(;A<=_;)s(this,v,A),A+=this.blockSize;if(typeof v=="string"){for(;A<m;)if(T[I++]=v.charCodeAt(A++),I==this.blockSize){s(this,T),I=0;break}}else for(;A<m;)if(T[I++]=v[A++],I==this.blockSize){s(this,T),I=0;break}}this.h=I,this.o+=m},r.prototype.v=function(){var v=Array((56>this.h?this.blockSize:2*this.blockSize)-this.h);v[0]=128;for(var m=1;m<v.length-8;++m)v[m]=0;var _=8*this.o;for(m=v.length-8;m<v.length;++m)v[m]=_&255,_/=256;for(this.u(v),v=Array(16),m=_=0;4>m;++m)for(var T=0;32>T;T+=8)v[_++]=this.g[m]>>>T&255;return v};function o(v,m){var _=u;return Object.prototype.hasOwnProperty.call(_,v)?_[v]:_[v]=m(v)}function a(v,m){this.h=m;for(var _=[],T=!0,I=v.length-1;0<=I;I--){var A=v[I]|0;T&&A==m||(_[I]=A,T=!1)}this.g=_}var u={};function h(v){return-128<=v&&128>v?o(v,function(m){return new a([m|0],0>m?-1:0)}):new a([v|0],0>v?-1:0)}function d(v){if(isNaN(v)||!isFinite(v))return y;if(0>v)return k(d(-v));for(var m=[],_=1,T=0;v>=_;T++)m[T]=v/_|0,_*=4294967296;return new a(m,0)}function p(v,m){if(v.length==0)throw Error("number format error: empty string");if(m=m||10,2>m||36<m)throw Error("radix out of range: "+m);if(v.charAt(0)=="-")return k(p(v.substring(1),m));if(0<=v.indexOf("-"))throw Error('number format error: interior "-" character');for(var _=d(Math.pow(m,8)),T=y,I=0;I<v.length;I+=8){var A=Math.min(8,v.length-I),g=parseInt(v.substring(I,I+A),m);8>A?(A=d(Math.pow(m,A)),T=T.j(A).add(d(g))):(T=T.j(_),T=T.add(d(g)))}return T}var y=h(0),E=h(1),C=h(16777216);n=a.prototype,n.m=function(){if(O(this))return-k(this).m();for(var v=0,m=1,_=0;_<this.g.length;_++){var T=this.i(_);v+=(0<=T?T:4294967296+T)*m,m*=4294967296}return v},n.toString=function(v){if(v=v||10,2>v||36<v)throw Error("radix out of range: "+v);if(b(this))return"0";if(O(this))return"-"+k(this).toString(v);for(var m=d(Math.pow(v,6)),_=this,T="";;){var I=ue(_,m).g;_=z(_,I.j(m));var A=((0<_.g.length?_.g[0]:_.h)>>>0).toString(v);if(_=I,b(_))return A+T;for(;6>A.length;)A="0"+A;T=A+T}},n.i=function(v){return 0>v?0:v<this.g.length?this.g[v]:this.h};function b(v){if(v.h!=0)return!1;for(var m=0;m<v.g.length;m++)if(v.g[m]!=0)return!1;return!0}function O(v){return v.h==-1}n.l=function(v){return v=z(this,v),O(v)?-1:b(v)?0:1};function k(v){for(var m=v.g.length,_=[],T=0;T<m;T++)_[T]=~v.g[T];return new a(_,~v.h).add(E)}n.abs=function(){return O(this)?k(this):this},n.add=function(v){for(var m=Math.max(this.g.length,v.g.length),_=[],T=0,I=0;I<=m;I++){var A=T+(this.i(I)&65535)+(v.i(I)&65535),g=(A>>>16)+(this.i(I)>>>16)+(v.i(I)>>>16);T=g>>>16,A&=65535,g&=65535,_[I]=g<<16|A}return new a(_,_[_.length-1]&-2147483648?-1:0)};function z(v,m){return v.add(k(m))}n.j=function(v){if(b(this)||b(v))return y;if(O(this))return O(v)?k(this).j(k(v)):k(k(this).j(v));if(O(v))return k(this.j(k(v)));if(0>this.l(C)&&0>v.l(C))return d(this.m()*v.m());for(var m=this.g.length+v.g.length,_=[],T=0;T<2*m;T++)_[T]=0;for(T=0;T<this.g.length;T++)for(var I=0;I<v.g.length;I++){var A=this.i(T)>>>16,g=this.i(T)&65535,Ge=v.i(I)>>>16,vn=v.i(I)&65535;_[2*T+2*I]+=g*vn,B(_,2*T+2*I),_[2*T+2*I+1]+=A*vn,B(_,2*T+2*I+1),_[2*T+2*I+1]+=g*Ge,B(_,2*T+2*I+1),_[2*T+2*I+2]+=A*Ge,B(_,2*T+2*I+2)}for(T=0;T<m;T++)_[T]=_[2*T+1]<<16|_[2*T];for(T=m;T<2*m;T++)_[T]=0;return new a(_,0)};function B(v,m){for(;(v[m]&65535)!=v[m];)v[m+1]+=v[m]>>>16,v[m]&=65535,m++}function H(v,m){this.g=v,this.h=m}function ue(v,m){if(b(m))throw Error("division by zero");if(b(v))return new H(y,y);if(O(v))return m=ue(k(v),m),new H(k(m.g),k(m.h));if(O(m))return m=ue(v,k(m)),new H(k(m.g),m.h);if(30<v.g.length){if(O(v)||O(m))throw Error("slowDivide_ only works with positive integers.");for(var _=E,T=m;0>=T.l(v);)_=xe(_),T=xe(T);var I=pe(_,1),A=pe(T,1);for(T=pe(T,2),_=pe(_,2);!b(T);){var g=A.add(T);0>=g.l(v)&&(I=I.add(_),A=g),T=pe(T,1),_=pe(_,1)}return m=z(v,I.j(m)),new H(I,m)}for(I=y;0<=v.l(m);){for(_=Math.max(1,Math.floor(v.m()/m.m())),T=Math.ceil(Math.log(_)/Math.LN2),T=48>=T?1:Math.pow(2,T-48),A=d(_),g=A.j(m);O(g)||0<g.l(v);)_-=T,A=d(_),g=A.j(m);b(A)&&(A=E),I=I.add(A),v=z(v,g)}return new H(I,v)}n.A=function(v){return ue(this,v).h},n.and=function(v){for(var m=Math.max(this.g.length,v.g.length),_=[],T=0;T<m;T++)_[T]=this.i(T)&v.i(T);return new a(_,this.h&v.h)},n.or=function(v){for(var m=Math.max(this.g.length,v.g.length),_=[],T=0;T<m;T++)_[T]=this.i(T)|v.i(T);return new a(_,this.h|v.h)},n.xor=function(v){for(var m=Math.max(this.g.length,v.g.length),_=[],T=0;T<m;T++)_[T]=this.i(T)^v.i(T);return new a(_,this.h^v.h)};function xe(v){for(var m=v.g.length+1,_=[],T=0;T<m;T++)_[T]=v.i(T)<<1|v.i(T-1)>>>31;return new a(_,v.h)}function pe(v,m){var _=m>>5;m%=32;for(var T=v.g.length-_,I=[],A=0;A<T;A++)I[A]=0<m?v.i(A+_)>>>m|v.i(A+_+1)<<32-m:v.i(A+_);return new a(I,v.h)}r.prototype.digest=r.prototype.v,r.prototype.reset=r.prototype.s,r.prototype.update=r.prototype.u,yl=r,a.prototype.add=a.prototype.add,a.prototype.multiply=a.prototype.j,a.prototype.modulo=a.prototype.A,a.prototype.compare=a.prototype.l,a.prototype.toNumber=a.prototype.m,a.prototype.toString=a.prototype.toString,a.prototype.getBits=a.prototype.i,a.fromNumber=d,a.fromString=p,yt=a}).apply(typeof Sc<"u"?Sc:typeof self<"u"?self:typeof window<"u"?window:{});var Fr=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof global<"u"?global:typeof self<"u"?self:{};/** @license
Copyright The Closure Library Authors.
SPDX-License-Identifier: Apache-2.0
*/var El,Un,Tl,Qr,Li,Il,vl,wl;(function(){var n,e=typeof Object.defineProperties=="function"?Object.defineProperty:function(i,c,l){return i==Array.prototype||i==Object.prototype||(i[c]=l.value),i};function t(i){i=[typeof globalThis=="object"&&globalThis,i,typeof window=="object"&&window,typeof self=="object"&&self,typeof Fr=="object"&&Fr];for(var c=0;c<i.length;++c){var l=i[c];if(l&&l.Math==Math)return l}throw Error("Cannot find global object")}var r=t(this);function s(i,c){if(c)e:{var l=r;i=i.split(".");for(var f=0;f<i.length-1;f++){var w=i[f];if(!(w in l))break e;l=l[w]}i=i[i.length-1],f=l[i],c=c(f),c!=f&&c!=null&&e(l,i,{configurable:!0,writable:!0,value:c})}}function o(i,c){i instanceof String&&(i+="");var l=0,f=!1,w={next:function(){if(!f&&l<i.length){var R=l++;return{value:c(R,i[R]),done:!1}}return f=!0,{done:!0,value:void 0}}};return w[Symbol.iterator]=function(){return w},w}s("Array.prototype.values",function(i){return i||function(){return o(this,function(c,l){return l})}});/** @license

 Copyright The Closure Library Authors.
 SPDX-License-Identifier: Apache-2.0
*/var a=a||{},u=this||self;function h(i){var c=typeof i;return c=c!="object"?c:i?Array.isArray(i)?"array":c:"null",c=="array"||c=="object"&&typeof i.length=="number"}function d(i){var c=typeof i;return c=="object"&&i!=null||c=="function"}function p(i,c,l){return i.call.apply(i.bind,arguments)}function y(i,c,l){if(!i)throw Error();if(2<arguments.length){var f=Array.prototype.slice.call(arguments,2);return function(){var w=Array.prototype.slice.call(arguments);return Array.prototype.unshift.apply(w,f),i.apply(c,w)}}return function(){return i.apply(c,arguments)}}function E(i,c,l){return E=Function.prototype.bind&&Function.prototype.bind.toString().indexOf("native code")!=-1?p:y,E.apply(null,arguments)}function C(i,c){var l=Array.prototype.slice.call(arguments,1);return function(){var f=l.slice();return f.push.apply(f,arguments),i.apply(this,f)}}function b(i,c){function l(){}l.prototype=c.prototype,i.aa=c.prototype,i.prototype=new l,i.prototype.constructor=i,i.Qb=function(f,w,R){for(var V=Array(arguments.length-2),Q=2;Q<arguments.length;Q++)V[Q-2]=arguments[Q];return c.prototype[w].apply(f,V)}}function O(i){const c=i.length;if(0<c){const l=Array(c);for(let f=0;f<c;f++)l[f]=i[f];return l}return[]}function k(i,c){for(let l=1;l<arguments.length;l++){const f=arguments[l];if(h(f)){const w=i.length||0,R=f.length||0;i.length=w+R;for(let V=0;V<R;V++)i[w+V]=f[V]}else i.push(f)}}class z{constructor(c,l){this.i=c,this.j=l,this.h=0,this.g=null}get(){let c;return 0<this.h?(this.h--,c=this.g,this.g=c.next,c.next=null):c=this.i(),c}}function B(i){return/^[\s\xa0]*$/.test(i)}function H(){var i=u.navigator;return i&&(i=i.userAgent)?i:""}function ue(i){return ue[" "](i),i}ue[" "]=function(){};var xe=H().indexOf("Gecko")!=-1&&!(H().toLowerCase().indexOf("webkit")!=-1&&H().indexOf("Edge")==-1)&&!(H().indexOf("Trident")!=-1||H().indexOf("MSIE")!=-1)&&H().indexOf("Edge")==-1;function pe(i,c,l){for(const f in i)c.call(l,i[f],f,i)}function v(i,c){for(const l in i)c.call(void 0,i[l],l,i)}function m(i){const c={};for(const l in i)c[l]=i[l];return c}const _="constructor hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString toString valueOf".split(" ");function T(i,c){let l,f;for(let w=1;w<arguments.length;w++){f=arguments[w];for(l in f)i[l]=f[l];for(let R=0;R<_.length;R++)l=_[R],Object.prototype.hasOwnProperty.call(f,l)&&(i[l]=f[l])}}function I(i){var c=1;i=i.split(":");const l=[];for(;0<c&&i.length;)l.push(i.shift()),c--;return i.length&&l.push(i.join(":")),l}function A(i){u.setTimeout(()=>{throw i},0)}function g(){var i=Hs;let c=null;return i.g&&(c=i.g,i.g=i.g.next,i.g||(i.h=null),c.next=null),c}class Ge{constructor(){this.h=this.g=null}add(c,l){const f=vn.get();f.set(c,l),this.h?this.h.next=f:this.g=f,this.h=f}}var vn=new z(()=>new Yh,i=>i.reset());class Yh{constructor(){this.next=this.g=this.h=null}set(c,l){this.h=c,this.g=l,this.next=null}reset(){this.next=this.g=this.h=null}}let wn,An=!1,Hs=new Ge,Xo=()=>{const i=u.Promise.resolve(void 0);wn=()=>{i.then(Zh)}};var Zh=()=>{for(var i;i=g();){try{i.h.call(i.g)}catch(l){A(l)}var c=vn;c.j(i),100>c.h&&(c.h++,i.next=c.g,c.g=i)}An=!1};function ot(){this.s=this.s,this.C=this.C}ot.prototype.s=!1,ot.prototype.ma=function(){this.s||(this.s=!0,this.N())},ot.prototype.N=function(){if(this.C)for(;this.C.length;)this.C.shift()()};function me(i,c){this.type=i,this.g=this.target=c,this.defaultPrevented=!1}me.prototype.h=function(){this.defaultPrevented=!0};var ed=function(){if(!u.addEventListener||!Object.defineProperty)return!1;var i=!1,c=Object.defineProperty({},"passive",{get:function(){i=!0}});try{const l=()=>{};u.addEventListener("test",l,c),u.removeEventListener("test",l,c)}catch{}return i}();function Rn(i,c){if(me.call(this,i?i.type:""),this.relatedTarget=this.g=this.target=null,this.button=this.screenY=this.screenX=this.clientY=this.clientX=0,this.key="",this.metaKey=this.shiftKey=this.altKey=this.ctrlKey=!1,this.state=null,this.pointerId=0,this.pointerType="",this.i=null,i){var l=this.type=i.type,f=i.changedTouches&&i.changedTouches.length?i.changedTouches[0]:null;if(this.target=i.target||i.srcElement,this.g=c,c=i.relatedTarget){if(xe){e:{try{ue(c.nodeName);var w=!0;break e}catch{}w=!1}w||(c=null)}}else l=="mouseover"?c=i.fromElement:l=="mouseout"&&(c=i.toElement);this.relatedTarget=c,f?(this.clientX=f.clientX!==void 0?f.clientX:f.pageX,this.clientY=f.clientY!==void 0?f.clientY:f.pageY,this.screenX=f.screenX||0,this.screenY=f.screenY||0):(this.clientX=i.clientX!==void 0?i.clientX:i.pageX,this.clientY=i.clientY!==void 0?i.clientY:i.pageY,this.screenX=i.screenX||0,this.screenY=i.screenY||0),this.button=i.button,this.key=i.key||"",this.ctrlKey=i.ctrlKey,this.altKey=i.altKey,this.shiftKey=i.shiftKey,this.metaKey=i.metaKey,this.pointerId=i.pointerId||0,this.pointerType=typeof i.pointerType=="string"?i.pointerType:td[i.pointerType]||"",this.state=i.state,this.i=i,i.defaultPrevented&&Rn.aa.h.call(this)}}b(Rn,me);var td={2:"touch",3:"pen",4:"mouse"};Rn.prototype.h=function(){Rn.aa.h.call(this);var i=this.i;i.preventDefault?i.preventDefault():i.returnValue=!1};var yr="closure_listenable_"+(1e6*Math.random()|0),nd=0;function rd(i,c,l,f,w){this.listener=i,this.proxy=null,this.src=c,this.type=l,this.capture=!!f,this.ha=w,this.key=++nd,this.da=this.fa=!1}function Er(i){i.da=!0,i.listener=null,i.proxy=null,i.src=null,i.ha=null}function Tr(i){this.src=i,this.g={},this.h=0}Tr.prototype.add=function(i,c,l,f,w){var R=i.toString();i=this.g[R],i||(i=this.g[R]=[],this.h++);var V=Ws(i,c,f,w);return-1<V?(c=i[V],l||(c.fa=!1)):(c=new rd(c,this.src,R,!!f,w),c.fa=l,i.push(c)),c};function Gs(i,c){var l=c.type;if(l in i.g){var f=i.g[l],w=Array.prototype.indexOf.call(f,c,void 0),R;(R=0<=w)&&Array.prototype.splice.call(f,w,1),R&&(Er(c),i.g[l].length==0&&(delete i.g[l],i.h--))}}function Ws(i,c,l,f){for(var w=0;w<i.length;++w){var R=i[w];if(!R.da&&R.listener==c&&R.capture==!!l&&R.ha==f)return w}return-1}var Ks="closure_lm_"+(1e6*Math.random()|0),Qs={};function Yo(i,c,l,f,w){if(Array.isArray(c)){for(var R=0;R<c.length;R++)Yo(i,c[R],l,f,w);return null}return l=ta(l),i&&i[yr]?i.K(c,l,d(f)?!!f.capture:!1,w):sd(i,c,l,!1,f,w)}function sd(i,c,l,f,w,R){if(!c)throw Error("Invalid event type");var V=d(w)?!!w.capture:!!w,Q=Xs(i);if(Q||(i[Ks]=Q=new Tr(i)),l=Q.add(c,l,f,V,R),l.proxy)return l;if(f=id(),l.proxy=f,f.src=i,f.listener=l,i.addEventListener)ed||(w=V),w===void 0&&(w=!1),i.addEventListener(c.toString(),f,w);else if(i.attachEvent)i.attachEvent(ea(c.toString()),f);else if(i.addListener&&i.removeListener)i.addListener(f);else throw Error("addEventListener and attachEvent are unavailable.");return l}function id(){function i(l){return c.call(i.src,i.listener,l)}const c=od;return i}function Zo(i,c,l,f,w){if(Array.isArray(c))for(var R=0;R<c.length;R++)Zo(i,c[R],l,f,w);else f=d(f)?!!f.capture:!!f,l=ta(l),i&&i[yr]?(i=i.i,c=String(c).toString(),c in i.g&&(R=i.g[c],l=Ws(R,l,f,w),-1<l&&(Er(R[l]),Array.prototype.splice.call(R,l,1),R.length==0&&(delete i.g[c],i.h--)))):i&&(i=Xs(i))&&(c=i.g[c.toString()],i=-1,c&&(i=Ws(c,l,f,w)),(l=-1<i?c[i]:null)&&Js(l))}function Js(i){if(typeof i!="number"&&i&&!i.da){var c=i.src;if(c&&c[yr])Gs(c.i,i);else{var l=i.type,f=i.proxy;c.removeEventListener?c.removeEventListener(l,f,i.capture):c.detachEvent?c.detachEvent(ea(l),f):c.addListener&&c.removeListener&&c.removeListener(f),(l=Xs(c))?(Gs(l,i),l.h==0&&(l.src=null,c[Ks]=null)):Er(i)}}}function ea(i){return i in Qs?Qs[i]:Qs[i]="on"+i}function od(i,c){if(i.da)i=!0;else{c=new Rn(c,this);var l=i.listener,f=i.ha||i.src;i.fa&&Js(i),i=l.call(f,c)}return i}function Xs(i){return i=i[Ks],i instanceof Tr?i:null}var Ys="__closure_events_fn_"+(1e9*Math.random()>>>0);function ta(i){return typeof i=="function"?i:(i[Ys]||(i[Ys]=function(c){return i.handleEvent(c)}),i[Ys])}function ge(){ot.call(this),this.i=new Tr(this),this.M=this,this.F=null}b(ge,ot),ge.prototype[yr]=!0,ge.prototype.removeEventListener=function(i,c,l,f){Zo(this,i,c,l,f)};function we(i,c){var l,f=i.F;if(f)for(l=[];f;f=f.F)l.push(f);if(i=i.M,f=c.type||c,typeof c=="string")c=new me(c,i);else if(c instanceof me)c.target=c.target||i;else{var w=c;c=new me(f,i),T(c,w)}if(w=!0,l)for(var R=l.length-1;0<=R;R--){var V=c.g=l[R];w=Ir(V,f,!0,c)&&w}if(V=c.g=i,w=Ir(V,f,!0,c)&&w,w=Ir(V,f,!1,c)&&w,l)for(R=0;R<l.length;R++)V=c.g=l[R],w=Ir(V,f,!1,c)&&w}ge.prototype.N=function(){if(ge.aa.N.call(this),this.i){var i=this.i,c;for(c in i.g){for(var l=i.g[c],f=0;f<l.length;f++)Er(l[f]);delete i.g[c],i.h--}}this.F=null},ge.prototype.K=function(i,c,l,f){return this.i.add(String(i),c,!1,l,f)},ge.prototype.L=function(i,c,l,f){return this.i.add(String(i),c,!0,l,f)};function Ir(i,c,l,f){if(c=i.i.g[String(c)],!c)return!0;c=c.concat();for(var w=!0,R=0;R<c.length;++R){var V=c[R];if(V&&!V.da&&V.capture==l){var Q=V.listener,le=V.ha||V.src;V.fa&&Gs(i.i,V),w=Q.call(le,f)!==!1&&w}}return w&&!f.defaultPrevented}function na(i,c,l){if(typeof i=="function")l&&(i=E(i,l));else if(i&&typeof i.handleEvent=="function")i=E(i.handleEvent,i);else throw Error("Invalid listener argument");return 2147483647<Number(c)?-1:u.setTimeout(i,c||0)}function ra(i){i.g=na(()=>{i.g=null,i.i&&(i.i=!1,ra(i))},i.l);const c=i.h;i.h=null,i.m.apply(null,c)}class ad extends ot{constructor(c,l){super(),this.m=c,this.l=l,this.h=null,this.i=!1,this.g=null}j(c){this.h=arguments,this.g?this.i=!0:ra(this)}N(){super.N(),this.g&&(u.clearTimeout(this.g),this.g=null,this.i=!1,this.h=null)}}function Sn(i){ot.call(this),this.h=i,this.g={}}b(Sn,ot);var sa=[];function ia(i){pe(i.g,function(c,l){this.g.hasOwnProperty(l)&&Js(c)},i),i.g={}}Sn.prototype.N=function(){Sn.aa.N.call(this),ia(this)},Sn.prototype.handleEvent=function(){throw Error("EventHandler.handleEvent not implemented")};var Zs=u.JSON.stringify,cd=u.JSON.parse,ud=class{stringify(i){return u.JSON.stringify(i,void 0)}parse(i){return u.JSON.parse(i,void 0)}};function ei(){}ei.prototype.h=null;function oa(i){return i.h||(i.h=i.i())}function aa(){}var Pn={OPEN:"a",kb:"b",Ja:"c",wb:"d"};function ti(){me.call(this,"d")}b(ti,me);function ni(){me.call(this,"c")}b(ni,me);var bt={},ca=null;function vr(){return ca=ca||new ge}bt.La="serverreachability";function ua(i){me.call(this,bt.La,i)}b(ua,me);function Cn(i){const c=vr();we(c,new ua(c))}bt.STAT_EVENT="statevent";function la(i,c){me.call(this,bt.STAT_EVENT,i),this.stat=c}b(la,me);function Ae(i){const c=vr();we(c,new la(c,i))}bt.Ma="timingevent";function ha(i,c){me.call(this,bt.Ma,i),this.size=c}b(ha,me);function bn(i,c){if(typeof i!="function")throw Error("Fn must not be null and must be a function");return u.setTimeout(function(){i()},c)}function Vn(){this.g=!0}Vn.prototype.xa=function(){this.g=!1};function ld(i,c,l,f,w,R){i.info(function(){if(i.g)if(R)for(var V="",Q=R.split("&"),le=0;le<Q.length;le++){var W=Q[le].split("=");if(1<W.length){var _e=W[0];W=W[1];var ye=_e.split("_");V=2<=ye.length&&ye[1]=="type"?V+(_e+"="+W+"&"):V+(_e+"=redacted&")}}else V=null;else V=R;return"XMLHTTP REQ ("+f+") [attempt "+w+"]: "+c+`
`+l+`
`+V})}function hd(i,c,l,f,w,R,V){i.info(function(){return"XMLHTTP RESP ("+f+") [ attempt "+w+"]: "+c+`
`+l+`
`+R+" "+V})}function Gt(i,c,l,f){i.info(function(){return"XMLHTTP TEXT ("+c+"): "+fd(i,l)+(f?" "+f:"")})}function dd(i,c){i.info(function(){return"TIMEOUT: "+c})}Vn.prototype.info=function(){};function fd(i,c){if(!i.g)return c;if(!c)return null;try{var l=JSON.parse(c);if(l){for(i=0;i<l.length;i++)if(Array.isArray(l[i])){var f=l[i];if(!(2>f.length)){var w=f[1];if(Array.isArray(w)&&!(1>w.length)){var R=w[0];if(R!="noop"&&R!="stop"&&R!="close")for(var V=1;V<w.length;V++)w[V]=""}}}}return Zs(l)}catch{return c}}var wr={NO_ERROR:0,gb:1,tb:2,sb:3,nb:4,rb:5,ub:6,Ia:7,TIMEOUT:8,xb:9},da={lb:"complete",Hb:"success",Ja:"error",Ia:"abort",zb:"ready",Ab:"readystatechange",TIMEOUT:"timeout",vb:"incrementaldata",yb:"progress",ob:"downloadprogress",Pb:"uploadprogress"},ri;function Ar(){}b(Ar,ei),Ar.prototype.g=function(){return new XMLHttpRequest},Ar.prototype.i=function(){return{}},ri=new Ar;function at(i,c,l,f){this.j=i,this.i=c,this.l=l,this.R=f||1,this.U=new Sn(this),this.I=45e3,this.H=null,this.o=!1,this.m=this.A=this.v=this.L=this.F=this.S=this.B=null,this.D=[],this.g=null,this.C=0,this.s=this.u=null,this.X=-1,this.J=!1,this.O=0,this.M=null,this.W=this.K=this.T=this.P=!1,this.h=new fa}function fa(){this.i=null,this.g="",this.h=!1}var pa={},si={};function ii(i,c,l){i.L=1,i.v=Cr(We(c)),i.m=l,i.P=!0,ma(i,null)}function ma(i,c){i.F=Date.now(),Rr(i),i.A=We(i.v);var l=i.A,f=i.R;Array.isArray(f)||(f=[String(f)]),ba(l.i,"t",f),i.C=0,l=i.j.J,i.h=new fa,i.g=Wa(i.j,l?c:null,!i.m),0<i.O&&(i.M=new ad(E(i.Y,i,i.g),i.O)),c=i.U,l=i.g,f=i.ca;var w="readystatechange";Array.isArray(w)||(w&&(sa[0]=w.toString()),w=sa);for(var R=0;R<w.length;R++){var V=Yo(l,w[R],f||c.handleEvent,!1,c.h||c);if(!V)break;c.g[V.key]=V}c=i.H?m(i.H):{},i.m?(i.u||(i.u="POST"),c["Content-Type"]="application/x-www-form-urlencoded",i.g.ea(i.A,i.u,i.m,c)):(i.u="GET",i.g.ea(i.A,i.u,null,c)),Cn(),ld(i.i,i.u,i.A,i.l,i.R,i.m)}at.prototype.ca=function(i){i=i.target;const c=this.M;c&&Ke(i)==3?c.j():this.Y(i)},at.prototype.Y=function(i){try{if(i==this.g)e:{const ye=Ke(this.g);var c=this.g.Ba();const Qt=this.g.Z();if(!(3>ye)&&(ye!=3||this.g&&(this.h.h||this.g.oa()||La(this.g)))){this.J||ye!=4||c==7||(c==8||0>=Qt?Cn(3):Cn(2)),oi(this);var l=this.g.Z();this.X=l;t:if(ga(this)){var f=La(this.g);i="";var w=f.length,R=Ke(this.g)==4;if(!this.h.i){if(typeof TextDecoder>"u"){Vt(this),kn(this);var V="";break t}this.h.i=new u.TextDecoder}for(c=0;c<w;c++)this.h.h=!0,i+=this.h.i.decode(f[c],{stream:!(R&&c==w-1)});f.length=0,this.h.g+=i,this.C=0,V=this.h.g}else V=this.g.oa();if(this.o=l==200,hd(this.i,this.u,this.A,this.l,this.R,ye,l),this.o){if(this.T&&!this.K){t:{if(this.g){var Q,le=this.g;if((Q=le.g?le.g.getResponseHeader("X-HTTP-Initial-Response"):null)&&!B(Q)){var W=Q;break t}}W=null}if(l=W)Gt(this.i,this.l,l,"Initial handshake response via X-HTTP-Initial-Response"),this.K=!0,ai(this,l);else{this.o=!1,this.s=3,Ae(12),Vt(this),kn(this);break e}}if(this.P){l=!0;let De;for(;!this.J&&this.C<V.length;)if(De=pd(this,V),De==si){ye==4&&(this.s=4,Ae(14),l=!1),Gt(this.i,this.l,null,"[Incomplete Response]");break}else if(De==pa){this.s=4,Ae(15),Gt(this.i,this.l,V,"[Invalid Chunk]"),l=!1;break}else Gt(this.i,this.l,De,null),ai(this,De);if(ga(this)&&this.C!=0&&(this.h.g=this.h.g.slice(this.C),this.C=0),ye!=4||V.length!=0||this.h.h||(this.s=1,Ae(16),l=!1),this.o=this.o&&l,!l)Gt(this.i,this.l,V,"[Invalid Chunked Response]"),Vt(this),kn(this);else if(0<V.length&&!this.W){this.W=!0;var _e=this.j;_e.g==this&&_e.ba&&!_e.M&&(_e.j.info("Great, no buffering proxy detected. Bytes received: "+V.length),fi(_e),_e.M=!0,Ae(11))}}else Gt(this.i,this.l,V,null),ai(this,V);ye==4&&Vt(this),this.o&&!this.J&&(ye==4?$a(this.j,this):(this.o=!1,Rr(this)))}else kd(this.g),l==400&&0<V.indexOf("Unknown SID")?(this.s=3,Ae(12)):(this.s=0,Ae(13)),Vt(this),kn(this)}}}catch{}finally{}};function ga(i){return i.g?i.u=="GET"&&i.L!=2&&i.j.Ca:!1}function pd(i,c){var l=i.C,f=c.indexOf(`
`,l);return f==-1?si:(l=Number(c.substring(l,f)),isNaN(l)?pa:(f+=1,f+l>c.length?si:(c=c.slice(f,f+l),i.C=f+l,c)))}at.prototype.cancel=function(){this.J=!0,Vt(this)};function Rr(i){i.S=Date.now()+i.I,_a(i,i.I)}function _a(i,c){if(i.B!=null)throw Error("WatchDog timer not null");i.B=bn(E(i.ba,i),c)}function oi(i){i.B&&(u.clearTimeout(i.B),i.B=null)}at.prototype.ba=function(){this.B=null;const i=Date.now();0<=i-this.S?(dd(this.i,this.A),this.L!=2&&(Cn(),Ae(17)),Vt(this),this.s=2,kn(this)):_a(this,this.S-i)};function kn(i){i.j.G==0||i.J||$a(i.j,i)}function Vt(i){oi(i);var c=i.M;c&&typeof c.ma=="function"&&c.ma(),i.M=null,ia(i.U),i.g&&(c=i.g,i.g=null,c.abort(),c.ma())}function ai(i,c){try{var l=i.j;if(l.G!=0&&(l.g==i||ci(l.h,i))){if(!i.K&&ci(l.h,i)&&l.G==3){try{var f=l.Da.g.parse(c)}catch{f=null}if(Array.isArray(f)&&f.length==3){var w=f;if(w[0]==0){e:if(!l.u){if(l.g)if(l.g.F+3e3<i.F)Or(l),Dr(l);else break e;di(l),Ae(18)}}else l.za=w[1],0<l.za-l.T&&37500>w[2]&&l.F&&l.v==0&&!l.C&&(l.C=bn(E(l.Za,l),6e3));if(1>=Ta(l.h)&&l.ca){try{l.ca()}catch{}l.ca=void 0}}else Dt(l,11)}else if((i.K||l.g==i)&&Or(l),!B(c))for(w=l.Da.g.parse(c),c=0;c<w.length;c++){let W=w[c];if(l.T=W[0],W=W[1],l.G==2)if(W[0]=="c"){l.K=W[1],l.ia=W[2];const _e=W[3];_e!=null&&(l.la=_e,l.j.info("VER="+l.la));const ye=W[4];ye!=null&&(l.Aa=ye,l.j.info("SVER="+l.Aa));const Qt=W[5];Qt!=null&&typeof Qt=="number"&&0<Qt&&(f=1.5*Qt,l.L=f,l.j.info("backChannelRequestTimeoutMs_="+f)),f=l;const De=i.g;if(De){const Lr=De.g?De.g.getResponseHeader("X-Client-Wire-Protocol"):null;if(Lr){var R=f.h;R.g||Lr.indexOf("spdy")==-1&&Lr.indexOf("quic")==-1&&Lr.indexOf("h2")==-1||(R.j=R.l,R.g=new Set,R.h&&(ui(R,R.h),R.h=null))}if(f.D){const pi=De.g?De.g.getResponseHeader("X-HTTP-Session-Id"):null;pi&&(f.ya=pi,X(f.I,f.D,pi))}}l.G=3,l.l&&l.l.ua(),l.ba&&(l.R=Date.now()-i.F,l.j.info("Handshake RTT: "+l.R+"ms")),f=l;var V=i;if(f.qa=Ga(f,f.J?f.ia:null,f.W),V.K){Ia(f.h,V);var Q=V,le=f.L;le&&(Q.I=le),Q.B&&(oi(Q),Rr(Q)),f.g=V}else ja(f);0<l.i.length&&Nr(l)}else W[0]!="stop"&&W[0]!="close"||Dt(l,7);else l.G==3&&(W[0]=="stop"||W[0]=="close"?W[0]=="stop"?Dt(l,7):hi(l):W[0]!="noop"&&l.l&&l.l.ta(W),l.v=0)}}Cn(4)}catch{}}var md=class{constructor(i,c){this.g=i,this.map=c}};function ya(i){this.l=i||10,u.PerformanceNavigationTiming?(i=u.performance.getEntriesByType("navigation"),i=0<i.length&&(i[0].nextHopProtocol=="hq"||i[0].nextHopProtocol=="h2")):i=!!(u.chrome&&u.chrome.loadTimes&&u.chrome.loadTimes()&&u.chrome.loadTimes().wasFetchedViaSpdy),this.j=i?this.l:1,this.g=null,1<this.j&&(this.g=new Set),this.h=null,this.i=[]}function Ea(i){return i.h?!0:i.g?i.g.size>=i.j:!1}function Ta(i){return i.h?1:i.g?i.g.size:0}function ci(i,c){return i.h?i.h==c:i.g?i.g.has(c):!1}function ui(i,c){i.g?i.g.add(c):i.h=c}function Ia(i,c){i.h&&i.h==c?i.h=null:i.g&&i.g.has(c)&&i.g.delete(c)}ya.prototype.cancel=function(){if(this.i=va(this),this.h)this.h.cancel(),this.h=null;else if(this.g&&this.g.size!==0){for(const i of this.g.values())i.cancel();this.g.clear()}};function va(i){if(i.h!=null)return i.i.concat(i.h.D);if(i.g!=null&&i.g.size!==0){let c=i.i;for(const l of i.g.values())c=c.concat(l.D);return c}return O(i.i)}function gd(i){if(i.V&&typeof i.V=="function")return i.V();if(typeof Map<"u"&&i instanceof Map||typeof Set<"u"&&i instanceof Set)return Array.from(i.values());if(typeof i=="string")return i.split("");if(h(i)){for(var c=[],l=i.length,f=0;f<l;f++)c.push(i[f]);return c}c=[],l=0;for(f in i)c[l++]=i[f];return c}function _d(i){if(i.na&&typeof i.na=="function")return i.na();if(!i.V||typeof i.V!="function"){if(typeof Map<"u"&&i instanceof Map)return Array.from(i.keys());if(!(typeof Set<"u"&&i instanceof Set)){if(h(i)||typeof i=="string"){var c=[];i=i.length;for(var l=0;l<i;l++)c.push(l);return c}c=[],l=0;for(const f in i)c[l++]=f;return c}}}function wa(i,c){if(i.forEach&&typeof i.forEach=="function")i.forEach(c,void 0);else if(h(i)||typeof i=="string")Array.prototype.forEach.call(i,c,void 0);else for(var l=_d(i),f=gd(i),w=f.length,R=0;R<w;R++)c.call(void 0,f[R],l&&l[R],i)}var Aa=RegExp("^(?:([^:/?#.]+):)?(?://(?:([^\\\\/?#]*)@)?([^\\\\/?#]*?)(?::([0-9]+))?(?=[\\\\/?#]|$))?([^?#]+)?(?:\\?([^#]*))?(?:#([\\s\\S]*))?$");function yd(i,c){if(i){i=i.split("&");for(var l=0;l<i.length;l++){var f=i[l].indexOf("="),w=null;if(0<=f){var R=i[l].substring(0,f);w=i[l].substring(f+1)}else R=i[l];c(R,w?decodeURIComponent(w.replace(/\+/g," ")):"")}}}function kt(i){if(this.g=this.o=this.j="",this.s=null,this.m=this.l="",this.h=!1,i instanceof kt){this.h=i.h,Sr(this,i.j),this.o=i.o,this.g=i.g,Pr(this,i.s),this.l=i.l;var c=i.i,l=new On;l.i=c.i,c.g&&(l.g=new Map(c.g),l.h=c.h),Ra(this,l),this.m=i.m}else i&&(c=String(i).match(Aa))?(this.h=!1,Sr(this,c[1]||"",!0),this.o=Dn(c[2]||""),this.g=Dn(c[3]||"",!0),Pr(this,c[4]),this.l=Dn(c[5]||"",!0),Ra(this,c[6]||"",!0),this.m=Dn(c[7]||"")):(this.h=!1,this.i=new On(null,this.h))}kt.prototype.toString=function(){var i=[],c=this.j;c&&i.push(Nn(c,Sa,!0),":");var l=this.g;return(l||c=="file")&&(i.push("//"),(c=this.o)&&i.push(Nn(c,Sa,!0),"@"),i.push(encodeURIComponent(String(l)).replace(/%25([0-9a-fA-F]{2})/g,"%$1")),l=this.s,l!=null&&i.push(":",String(l))),(l=this.l)&&(this.g&&l.charAt(0)!="/"&&i.push("/"),i.push(Nn(l,l.charAt(0)=="/"?Id:Td,!0))),(l=this.i.toString())&&i.push("?",l),(l=this.m)&&i.push("#",Nn(l,wd)),i.join("")};function We(i){return new kt(i)}function Sr(i,c,l){i.j=l?Dn(c,!0):c,i.j&&(i.j=i.j.replace(/:$/,""))}function Pr(i,c){if(c){if(c=Number(c),isNaN(c)||0>c)throw Error("Bad port number "+c);i.s=c}else i.s=null}function Ra(i,c,l){c instanceof On?(i.i=c,Ad(i.i,i.h)):(l||(c=Nn(c,vd)),i.i=new On(c,i.h))}function X(i,c,l){i.i.set(c,l)}function Cr(i){return X(i,"zx",Math.floor(2147483648*Math.random()).toString(36)+Math.abs(Math.floor(2147483648*Math.random())^Date.now()).toString(36)),i}function Dn(i,c){return i?c?decodeURI(i.replace(/%25/g,"%2525")):decodeURIComponent(i):""}function Nn(i,c,l){return typeof i=="string"?(i=encodeURI(i).replace(c,Ed),l&&(i=i.replace(/%25([0-9a-fA-F]{2})/g,"%$1")),i):null}function Ed(i){return i=i.charCodeAt(0),"%"+(i>>4&15).toString(16)+(i&15).toString(16)}var Sa=/[#\/\?@]/g,Td=/[#\?:]/g,Id=/[#\?]/g,vd=/[#\?@]/g,wd=/#/g;function On(i,c){this.h=this.g=null,this.i=i||null,this.j=!!c}function ct(i){i.g||(i.g=new Map,i.h=0,i.i&&yd(i.i,function(c,l){i.add(decodeURIComponent(c.replace(/\+/g," ")),l)}))}n=On.prototype,n.add=function(i,c){ct(this),this.i=null,i=Wt(this,i);var l=this.g.get(i);return l||this.g.set(i,l=[]),l.push(c),this.h+=1,this};function Pa(i,c){ct(i),c=Wt(i,c),i.g.has(c)&&(i.i=null,i.h-=i.g.get(c).length,i.g.delete(c))}function Ca(i,c){return ct(i),c=Wt(i,c),i.g.has(c)}n.forEach=function(i,c){ct(this),this.g.forEach(function(l,f){l.forEach(function(w){i.call(c,w,f,this)},this)},this)},n.na=function(){ct(this);const i=Array.from(this.g.values()),c=Array.from(this.g.keys()),l=[];for(let f=0;f<c.length;f++){const w=i[f];for(let R=0;R<w.length;R++)l.push(c[f])}return l},n.V=function(i){ct(this);let c=[];if(typeof i=="string")Ca(this,i)&&(c=c.concat(this.g.get(Wt(this,i))));else{i=Array.from(this.g.values());for(let l=0;l<i.length;l++)c=c.concat(i[l])}return c},n.set=function(i,c){return ct(this),this.i=null,i=Wt(this,i),Ca(this,i)&&(this.h-=this.g.get(i).length),this.g.set(i,[c]),this.h+=1,this},n.get=function(i,c){return i?(i=this.V(i),0<i.length?String(i[0]):c):c};function ba(i,c,l){Pa(i,c),0<l.length&&(i.i=null,i.g.set(Wt(i,c),O(l)),i.h+=l.length)}n.toString=function(){if(this.i)return this.i;if(!this.g)return"";const i=[],c=Array.from(this.g.keys());for(var l=0;l<c.length;l++){var f=c[l];const R=encodeURIComponent(String(f)),V=this.V(f);for(f=0;f<V.length;f++){var w=R;V[f]!==""&&(w+="="+encodeURIComponent(String(V[f]))),i.push(w)}}return this.i=i.join("&")};function Wt(i,c){return c=String(c),i.j&&(c=c.toLowerCase()),c}function Ad(i,c){c&&!i.j&&(ct(i),i.i=null,i.g.forEach(function(l,f){var w=f.toLowerCase();f!=w&&(Pa(this,f),ba(this,w,l))},i)),i.j=c}function Rd(i,c){const l=new Vn;if(u.Image){const f=new Image;f.onload=C(ut,l,"TestLoadImage: loaded",!0,c,f),f.onerror=C(ut,l,"TestLoadImage: error",!1,c,f),f.onabort=C(ut,l,"TestLoadImage: abort",!1,c,f),f.ontimeout=C(ut,l,"TestLoadImage: timeout",!1,c,f),u.setTimeout(function(){f.ontimeout&&f.ontimeout()},1e4),f.src=i}else c(!1)}function Sd(i,c){const l=new Vn,f=new AbortController,w=setTimeout(()=>{f.abort(),ut(l,"TestPingServer: timeout",!1,c)},1e4);fetch(i,{signal:f.signal}).then(R=>{clearTimeout(w),R.ok?ut(l,"TestPingServer: ok",!0,c):ut(l,"TestPingServer: server error",!1,c)}).catch(()=>{clearTimeout(w),ut(l,"TestPingServer: error",!1,c)})}function ut(i,c,l,f,w){try{w&&(w.onload=null,w.onerror=null,w.onabort=null,w.ontimeout=null),f(l)}catch{}}function Pd(){this.g=new ud}function Cd(i,c,l){const f=l||"";try{wa(i,function(w,R){let V=w;d(w)&&(V=Zs(w)),c.push(f+R+"="+encodeURIComponent(V))})}catch(w){throw c.push(f+"type="+encodeURIComponent("_badmap")),w}}function br(i){this.l=i.Ub||null,this.j=i.eb||!1}b(br,ei),br.prototype.g=function(){return new Vr(this.l,this.j)},br.prototype.i=function(i){return function(){return i}}({});function Vr(i,c){ge.call(this),this.D=i,this.o=c,this.m=void 0,this.status=this.readyState=0,this.responseType=this.responseText=this.response=this.statusText="",this.onreadystatechange=null,this.u=new Headers,this.h=null,this.B="GET",this.A="",this.g=!1,this.v=this.j=this.l=null}b(Vr,ge),n=Vr.prototype,n.open=function(i,c){if(this.readyState!=0)throw this.abort(),Error("Error reopening a connection");this.B=i,this.A=c,this.readyState=1,Ln(this)},n.send=function(i){if(this.readyState!=1)throw this.abort(),Error("need to call open() first. ");this.g=!0;const c={headers:this.u,method:this.B,credentials:this.m,cache:void 0};i&&(c.body=i),(this.D||u).fetch(new Request(this.A,c)).then(this.Sa.bind(this),this.ga.bind(this))},n.abort=function(){this.response=this.responseText="",this.u=new Headers,this.status=0,this.j&&this.j.cancel("Request was aborted.").catch(()=>{}),1<=this.readyState&&this.g&&this.readyState!=4&&(this.g=!1,Mn(this)),this.readyState=0},n.Sa=function(i){if(this.g&&(this.l=i,this.h||(this.status=this.l.status,this.statusText=this.l.statusText,this.h=i.headers,this.readyState=2,Ln(this)),this.g&&(this.readyState=3,Ln(this),this.g)))if(this.responseType==="arraybuffer")i.arrayBuffer().then(this.Qa.bind(this),this.ga.bind(this));else if(typeof u.ReadableStream<"u"&&"body"in i){if(this.j=i.body.getReader(),this.o){if(this.responseType)throw Error('responseType must be empty for "streamBinaryChunks" mode responses.');this.response=[]}else this.response=this.responseText="",this.v=new TextDecoder;Va(this)}else i.text().then(this.Ra.bind(this),this.ga.bind(this))};function Va(i){i.j.read().then(i.Pa.bind(i)).catch(i.ga.bind(i))}n.Pa=function(i){if(this.g){if(this.o&&i.value)this.response.push(i.value);else if(!this.o){var c=i.value?i.value:new Uint8Array(0);(c=this.v.decode(c,{stream:!i.done}))&&(this.response=this.responseText+=c)}i.done?Mn(this):Ln(this),this.readyState==3&&Va(this)}},n.Ra=function(i){this.g&&(this.response=this.responseText=i,Mn(this))},n.Qa=function(i){this.g&&(this.response=i,Mn(this))},n.ga=function(){this.g&&Mn(this)};function Mn(i){i.readyState=4,i.l=null,i.j=null,i.v=null,Ln(i)}n.setRequestHeader=function(i,c){this.u.append(i,c)},n.getResponseHeader=function(i){return this.h&&this.h.get(i.toLowerCase())||""},n.getAllResponseHeaders=function(){if(!this.h)return"";const i=[],c=this.h.entries();for(var l=c.next();!l.done;)l=l.value,i.push(l[0]+": "+l[1]),l=c.next();return i.join(`\r
`)};function Ln(i){i.onreadystatechange&&i.onreadystatechange.call(i)}Object.defineProperty(Vr.prototype,"withCredentials",{get:function(){return this.m==="include"},set:function(i){this.m=i?"include":"same-origin"}});function ka(i){let c="";return pe(i,function(l,f){c+=f,c+=":",c+=l,c+=`\r
`}),c}function li(i,c,l){e:{for(f in l){var f=!1;break e}f=!0}f||(l=ka(l),typeof i=="string"?l!=null&&encodeURIComponent(String(l)):X(i,c,l))}function ee(i){ge.call(this),this.headers=new Map,this.o=i||null,this.h=!1,this.v=this.g=null,this.D="",this.m=0,this.l="",this.j=this.B=this.u=this.A=!1,this.I=null,this.H="",this.J=!1}b(ee,ge);var bd=/^https?$/i,Vd=["POST","PUT"];n=ee.prototype,n.Ha=function(i){this.J=i},n.ea=function(i,c,l,f){if(this.g)throw Error("[goog.net.XhrIo] Object is active with another request="+this.D+"; newUri="+i);c=c?c.toUpperCase():"GET",this.D=i,this.l="",this.m=0,this.A=!1,this.h=!0,this.g=this.o?this.o.g():ri.g(),this.v=this.o?oa(this.o):oa(ri),this.g.onreadystatechange=E(this.Ea,this);try{this.B=!0,this.g.open(c,String(i),!0),this.B=!1}catch(R){Da(this,R);return}if(i=l||"",l=new Map(this.headers),f)if(Object.getPrototypeOf(f)===Object.prototype)for(var w in f)l.set(w,f[w]);else if(typeof f.keys=="function"&&typeof f.get=="function")for(const R of f.keys())l.set(R,f.get(R));else throw Error("Unknown input type for opt_headers: "+String(f));f=Array.from(l.keys()).find(R=>R.toLowerCase()=="content-type"),w=u.FormData&&i instanceof u.FormData,!(0<=Array.prototype.indexOf.call(Vd,c,void 0))||f||w||l.set("Content-Type","application/x-www-form-urlencoded;charset=utf-8");for(const[R,V]of l)this.g.setRequestHeader(R,V);this.H&&(this.g.responseType=this.H),"withCredentials"in this.g&&this.g.withCredentials!==this.J&&(this.g.withCredentials=this.J);try{Ma(this),this.u=!0,this.g.send(i),this.u=!1}catch(R){Da(this,R)}};function Da(i,c){i.h=!1,i.g&&(i.j=!0,i.g.abort(),i.j=!1),i.l=c,i.m=5,Na(i),kr(i)}function Na(i){i.A||(i.A=!0,we(i,"complete"),we(i,"error"))}n.abort=function(i){this.g&&this.h&&(this.h=!1,this.j=!0,this.g.abort(),this.j=!1,this.m=i||7,we(this,"complete"),we(this,"abort"),kr(this))},n.N=function(){this.g&&(this.h&&(this.h=!1,this.j=!0,this.g.abort(),this.j=!1),kr(this,!0)),ee.aa.N.call(this)},n.Ea=function(){this.s||(this.B||this.u||this.j?Oa(this):this.bb())},n.bb=function(){Oa(this)};function Oa(i){if(i.h&&typeof a<"u"&&(!i.v[1]||Ke(i)!=4||i.Z()!=2)){if(i.u&&Ke(i)==4)na(i.Ea,0,i);else if(we(i,"readystatechange"),Ke(i)==4){i.h=!1;try{const V=i.Z();e:switch(V){case 200:case 201:case 202:case 204:case 206:case 304:case 1223:var c=!0;break e;default:c=!1}var l;if(!(l=c)){var f;if(f=V===0){var w=String(i.D).match(Aa)[1]||null;!w&&u.self&&u.self.location&&(w=u.self.location.protocol.slice(0,-1)),f=!bd.test(w?w.toLowerCase():"")}l=f}if(l)we(i,"complete"),we(i,"success");else{i.m=6;try{var R=2<Ke(i)?i.g.statusText:""}catch{R=""}i.l=R+" ["+i.Z()+"]",Na(i)}}finally{kr(i)}}}}function kr(i,c){if(i.g){Ma(i);const l=i.g,f=i.v[0]?()=>{}:null;i.g=null,i.v=null,c||we(i,"ready");try{l.onreadystatechange=f}catch{}}}function Ma(i){i.I&&(u.clearTimeout(i.I),i.I=null)}n.isActive=function(){return!!this.g};function Ke(i){return i.g?i.g.readyState:0}n.Z=function(){try{return 2<Ke(this)?this.g.status:-1}catch{return-1}},n.oa=function(){try{return this.g?this.g.responseText:""}catch{return""}},n.Oa=function(i){if(this.g){var c=this.g.responseText;return i&&c.indexOf(i)==0&&(c=c.substring(i.length)),cd(c)}};function La(i){try{if(!i.g)return null;if("response"in i.g)return i.g.response;switch(i.H){case"":case"text":return i.g.responseText;case"arraybuffer":if("mozResponseArrayBuffer"in i.g)return i.g.mozResponseArrayBuffer}return null}catch{return null}}function kd(i){const c={};i=(i.g&&2<=Ke(i)&&i.g.getAllResponseHeaders()||"").split(`\r
`);for(let f=0;f<i.length;f++){if(B(i[f]))continue;var l=I(i[f]);const w=l[0];if(l=l[1],typeof l!="string")continue;l=l.trim();const R=c[w]||[];c[w]=R,R.push(l)}v(c,function(f){return f.join(", ")})}n.Ba=function(){return this.m},n.Ka=function(){return typeof this.l=="string"?this.l:String(this.l)};function xn(i,c,l){return l&&l.internalChannelParams&&l.internalChannelParams[i]||c}function xa(i){this.Aa=0,this.i=[],this.j=new Vn,this.ia=this.qa=this.I=this.W=this.g=this.ya=this.D=this.H=this.m=this.S=this.o=null,this.Ya=this.U=0,this.Va=xn("failFast",!1,i),this.F=this.C=this.u=this.s=this.l=null,this.X=!0,this.za=this.T=-1,this.Y=this.v=this.B=0,this.Ta=xn("baseRetryDelayMs",5e3,i),this.cb=xn("retryDelaySeedMs",1e4,i),this.Wa=xn("forwardChannelMaxRetries",2,i),this.wa=xn("forwardChannelRequestTimeoutMs",2e4,i),this.pa=i&&i.xmlHttpFactory||void 0,this.Xa=i&&i.Tb||void 0,this.Ca=i&&i.useFetchStreams||!1,this.L=void 0,this.J=i&&i.supportsCrossDomainXhr||!1,this.K="",this.h=new ya(i&&i.concurrentRequestLimit),this.Da=new Pd,this.P=i&&i.fastHandshake||!1,this.O=i&&i.encodeInitMessageHeaders||!1,this.P&&this.O&&(this.O=!1),this.Ua=i&&i.Rb||!1,i&&i.xa&&this.j.xa(),i&&i.forceLongPolling&&(this.X=!1),this.ba=!this.P&&this.X&&i&&i.detectBufferingProxy||!1,this.ja=void 0,i&&i.longPollingTimeout&&0<i.longPollingTimeout&&(this.ja=i.longPollingTimeout),this.ca=void 0,this.R=0,this.M=!1,this.ka=this.A=null}n=xa.prototype,n.la=8,n.G=1,n.connect=function(i,c,l,f){Ae(0),this.W=i,this.H=c||{},l&&f!==void 0&&(this.H.OSID=l,this.H.OAID=f),this.F=this.X,this.I=Ga(this,null,this.W),Nr(this)};function hi(i){if(Fa(i),i.G==3){var c=i.U++,l=We(i.I);if(X(l,"SID",i.K),X(l,"RID",c),X(l,"TYPE","terminate"),Fn(i,l),c=new at(i,i.j,c),c.L=2,c.v=Cr(We(l)),l=!1,u.navigator&&u.navigator.sendBeacon)try{l=u.navigator.sendBeacon(c.v.toString(),"")}catch{}!l&&u.Image&&(new Image().src=c.v,l=!0),l||(c.g=Wa(c.j,null),c.g.ea(c.v)),c.F=Date.now(),Rr(c)}Ha(i)}function Dr(i){i.g&&(fi(i),i.g.cancel(),i.g=null)}function Fa(i){Dr(i),i.u&&(u.clearTimeout(i.u),i.u=null),Or(i),i.h.cancel(),i.s&&(typeof i.s=="number"&&u.clearTimeout(i.s),i.s=null)}function Nr(i){if(!Ea(i.h)&&!i.s){i.s=!0;var c=i.Ga;wn||Xo(),An||(wn(),An=!0),Hs.add(c,i),i.B=0}}function Dd(i,c){return Ta(i.h)>=i.h.j-(i.s?1:0)?!1:i.s?(i.i=c.D.concat(i.i),!0):i.G==1||i.G==2||i.B>=(i.Va?0:i.Wa)?!1:(i.s=bn(E(i.Ga,i,c),za(i,i.B)),i.B++,!0)}n.Ga=function(i){if(this.s)if(this.s=null,this.G==1){if(!i){this.U=Math.floor(1e5*Math.random()),i=this.U++;const w=new at(this,this.j,i);let R=this.o;if(this.S&&(R?(R=m(R),T(R,this.S)):R=this.S),this.m!==null||this.O||(w.H=R,R=null),this.P)e:{for(var c=0,l=0;l<this.i.length;l++){t:{var f=this.i[l];if("__data__"in f.map&&(f=f.map.__data__,typeof f=="string")){f=f.length;break t}f=void 0}if(f===void 0)break;if(c+=f,4096<c){c=l;break e}if(c===4096||l===this.i.length-1){c=l+1;break e}}c=1e3}else c=1e3;c=Ba(this,w,c),l=We(this.I),X(l,"RID",i),X(l,"CVER",22),this.D&&X(l,"X-HTTP-Session-Id",this.D),Fn(this,l),R&&(this.O?c="headers="+encodeURIComponent(String(ka(R)))+"&"+c:this.m&&li(l,this.m,R)),ui(this.h,w),this.Ua&&X(l,"TYPE","init"),this.P?(X(l,"$req",c),X(l,"SID","null"),w.T=!0,ii(w,l,null)):ii(w,l,c),this.G=2}}else this.G==3&&(i?Ua(this,i):this.i.length==0||Ea(this.h)||Ua(this))};function Ua(i,c){var l;c?l=c.l:l=i.U++;const f=We(i.I);X(f,"SID",i.K),X(f,"RID",l),X(f,"AID",i.T),Fn(i,f),i.m&&i.o&&li(f,i.m,i.o),l=new at(i,i.j,l,i.B+1),i.m===null&&(l.H=i.o),c&&(i.i=c.D.concat(i.i)),c=Ba(i,l,1e3),l.I=Math.round(.5*i.wa)+Math.round(.5*i.wa*Math.random()),ui(i.h,l),ii(l,f,c)}function Fn(i,c){i.H&&pe(i.H,function(l,f){X(c,f,l)}),i.l&&wa({},function(l,f){X(c,f,l)})}function Ba(i,c,l){l=Math.min(i.i.length,l);var f=i.l?E(i.l.Na,i.l,i):null;e:{var w=i.i;let R=-1;for(;;){const V=["count="+l];R==-1?0<l?(R=w[0].g,V.push("ofs="+R)):R=0:V.push("ofs="+R);let Q=!0;for(let le=0;le<l;le++){let W=w[le].g;const _e=w[le].map;if(W-=R,0>W)R=Math.max(0,w[le].g-100),Q=!1;else try{Cd(_e,V,"req"+W+"_")}catch{f&&f(_e)}}if(Q){f=V.join("&");break e}}}return i=i.i.splice(0,l),c.D=i,f}function ja(i){if(!i.g&&!i.u){i.Y=1;var c=i.Fa;wn||Xo(),An||(wn(),An=!0),Hs.add(c,i),i.v=0}}function di(i){return i.g||i.u||3<=i.v?!1:(i.Y++,i.u=bn(E(i.Fa,i),za(i,i.v)),i.v++,!0)}n.Fa=function(){if(this.u=null,qa(this),this.ba&&!(this.M||this.g==null||0>=this.R)){var i=2*this.R;this.j.info("BP detection timer enabled: "+i),this.A=bn(E(this.ab,this),i)}},n.ab=function(){this.A&&(this.A=null,this.j.info("BP detection timeout reached."),this.j.info("Buffering proxy detected and switch to long-polling!"),this.F=!1,this.M=!0,Ae(10),Dr(this),qa(this))};function fi(i){i.A!=null&&(u.clearTimeout(i.A),i.A=null)}function qa(i){i.g=new at(i,i.j,"rpc",i.Y),i.m===null&&(i.g.H=i.o),i.g.O=0;var c=We(i.qa);X(c,"RID","rpc"),X(c,"SID",i.K),X(c,"AID",i.T),X(c,"CI",i.F?"0":"1"),!i.F&&i.ja&&X(c,"TO",i.ja),X(c,"TYPE","xmlhttp"),Fn(i,c),i.m&&i.o&&li(c,i.m,i.o),i.L&&(i.g.I=i.L);var l=i.g;i=i.ia,l.L=1,l.v=Cr(We(c)),l.m=null,l.P=!0,ma(l,i)}n.Za=function(){this.C!=null&&(this.C=null,Dr(this),di(this),Ae(19))};function Or(i){i.C!=null&&(u.clearTimeout(i.C),i.C=null)}function $a(i,c){var l=null;if(i.g==c){Or(i),fi(i),i.g=null;var f=2}else if(ci(i.h,c))l=c.D,Ia(i.h,c),f=1;else return;if(i.G!=0){if(c.o)if(f==1){l=c.m?c.m.length:0,c=Date.now()-c.F;var w=i.B;f=vr(),we(f,new ha(f,l)),Nr(i)}else ja(i);else if(w=c.s,w==3||w==0&&0<c.X||!(f==1&&Dd(i,c)||f==2&&di(i)))switch(l&&0<l.length&&(c=i.h,c.i=c.i.concat(l)),w){case 1:Dt(i,5);break;case 4:Dt(i,10);break;case 3:Dt(i,6);break;default:Dt(i,2)}}}function za(i,c){let l=i.Ta+Math.floor(Math.random()*i.cb);return i.isActive()||(l*=2),l*c}function Dt(i,c){if(i.j.info("Error code "+c),c==2){var l=E(i.fb,i),f=i.Xa;const w=!f;f=new kt(f||"//www.google.com/images/cleardot.gif"),u.location&&u.location.protocol=="http"||Sr(f,"https"),Cr(f),w?Rd(f.toString(),l):Sd(f.toString(),l)}else Ae(2);i.G=0,i.l&&i.l.sa(c),Ha(i),Fa(i)}n.fb=function(i){i?(this.j.info("Successfully pinged google.com"),Ae(2)):(this.j.info("Failed to ping google.com"),Ae(1))};function Ha(i){if(i.G=0,i.ka=[],i.l){const c=va(i.h);(c.length!=0||i.i.length!=0)&&(k(i.ka,c),k(i.ka,i.i),i.h.i.length=0,O(i.i),i.i.length=0),i.l.ra()}}function Ga(i,c,l){var f=l instanceof kt?We(l):new kt(l);if(f.g!="")c&&(f.g=c+"."+f.g),Pr(f,f.s);else{var w=u.location;f=w.protocol,c=c?c+"."+w.hostname:w.hostname,w=+w.port;var R=new kt(null);f&&Sr(R,f),c&&(R.g=c),w&&Pr(R,w),l&&(R.l=l),f=R}return l=i.D,c=i.ya,l&&c&&X(f,l,c),X(f,"VER",i.la),Fn(i,f),f}function Wa(i,c,l){if(c&&!i.J)throw Error("Can't create secondary domain capable XhrIo object.");return c=i.Ca&&!i.pa?new ee(new br({eb:l})):new ee(i.pa),c.Ha(i.J),c}n.isActive=function(){return!!this.l&&this.l.isActive(this)};function Ka(){}n=Ka.prototype,n.ua=function(){},n.ta=function(){},n.sa=function(){},n.ra=function(){},n.isActive=function(){return!0},n.Na=function(){};function Mr(){}Mr.prototype.g=function(i,c){return new Ce(i,c)};function Ce(i,c){ge.call(this),this.g=new xa(c),this.l=i,this.h=c&&c.messageUrlParams||null,i=c&&c.messageHeaders||null,c&&c.clientProtocolHeaderRequired&&(i?i["X-Client-Protocol"]="webchannel":i={"X-Client-Protocol":"webchannel"}),this.g.o=i,i=c&&c.initMessageHeaders||null,c&&c.messageContentType&&(i?i["X-WebChannel-Content-Type"]=c.messageContentType:i={"X-WebChannel-Content-Type":c.messageContentType}),c&&c.va&&(i?i["X-WebChannel-Client-Profile"]=c.va:i={"X-WebChannel-Client-Profile":c.va}),this.g.S=i,(i=c&&c.Sb)&&!B(i)&&(this.g.m=i),this.v=c&&c.supportsCrossDomainXhr||!1,this.u=c&&c.sendRawJson||!1,(c=c&&c.httpSessionIdParam)&&!B(c)&&(this.g.D=c,i=this.h,i!==null&&c in i&&(i=this.h,c in i&&delete i[c])),this.j=new Kt(this)}b(Ce,ge),Ce.prototype.m=function(){this.g.l=this.j,this.v&&(this.g.J=!0),this.g.connect(this.l,this.h||void 0)},Ce.prototype.close=function(){hi(this.g)},Ce.prototype.o=function(i){var c=this.g;if(typeof i=="string"){var l={};l.__data__=i,i=l}else this.u&&(l={},l.__data__=Zs(i),i=l);c.i.push(new md(c.Ya++,i)),c.G==3&&Nr(c)},Ce.prototype.N=function(){this.g.l=null,delete this.j,hi(this.g),delete this.g,Ce.aa.N.call(this)};function Qa(i){ti.call(this),i.__headers__&&(this.headers=i.__headers__,this.statusCode=i.__status__,delete i.__headers__,delete i.__status__);var c=i.__sm__;if(c){e:{for(const l in c){i=l;break e}i=void 0}(this.i=i)&&(i=this.i,c=c!==null&&i in c?c[i]:void 0),this.data=c}else this.data=i}b(Qa,ti);function Ja(){ni.call(this),this.status=1}b(Ja,ni);function Kt(i){this.g=i}b(Kt,Ka),Kt.prototype.ua=function(){we(this.g,"a")},Kt.prototype.ta=function(i){we(this.g,new Qa(i))},Kt.prototype.sa=function(i){we(this.g,new Ja)},Kt.prototype.ra=function(){we(this.g,"b")},Mr.prototype.createWebChannel=Mr.prototype.g,Ce.prototype.send=Ce.prototype.o,Ce.prototype.open=Ce.prototype.m,Ce.prototype.close=Ce.prototype.close,wl=function(){return new Mr},vl=function(){return vr()},Il=bt,Li={mb:0,pb:1,qb:2,Jb:3,Ob:4,Lb:5,Mb:6,Kb:7,Ib:8,Nb:9,PROXY:10,NOPROXY:11,Gb:12,Cb:13,Db:14,Bb:15,Eb:16,Fb:17,ib:18,hb:19,jb:20},wr.NO_ERROR=0,wr.TIMEOUT=8,wr.HTTP_ERROR=6,Qr=wr,da.COMPLETE="complete",Tl=da,aa.EventType=Pn,Pn.OPEN="a",Pn.CLOSE="b",Pn.ERROR="c",Pn.MESSAGE="d",ge.prototype.listen=ge.prototype.K,Un=aa,ee.prototype.listenOnce=ee.prototype.L,ee.prototype.getLastError=ee.prototype.Ka,ee.prototype.getLastErrorCode=ee.prototype.Ba,ee.prototype.getStatus=ee.prototype.Z,ee.prototype.getResponseJson=ee.prototype.Oa,ee.prototype.getResponseText=ee.prototype.oa,ee.prototype.send=ee.prototype.ea,ee.prototype.setWithCredentials=ee.prototype.Ha,El=ee}).apply(typeof Fr<"u"?Fr:typeof self<"u"?self:typeof window<"u"?window:{});const Pc="@firebase/firestore",Cc="4.9.0";/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Te{constructor(e){this.uid=e}isAuthenticated(){return this.uid!=null}toKey(){return this.isAuthenticated()?"uid:"+this.uid:"anonymous-user"}isEqual(e){return e.uid===this.uid}}Te.UNAUTHENTICATED=new Te(null),Te.GOOGLE_CREDENTIALS=new Te("google-credentials-uid"),Te.FIRST_PARTY=new Te("first-party-uid"),Te.MOCK_USER=new Te("mock-user");/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */let _n="12.0.0";/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const qt=new eo("@firebase/firestore");function Jt(){return qt.logLevel}function N(n,...e){if(qt.logLevel<=j.DEBUG){const t=e.map(po);qt.debug(`Firestore (${_n}): ${n}`,...t)}}function nt(n,...e){if(qt.logLevel<=j.ERROR){const t=e.map(po);qt.error(`Firestore (${_n}): ${n}`,...t)}}function an(n,...e){if(qt.logLevel<=j.WARN){const t=e.map(po);qt.warn(`Firestore (${_n}): ${n}`,...t)}}function po(n){if(typeof n=="string")return n;try{/**
* @license
* Copyright 2020 Google LLC
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/return function(t){return JSON.stringify(t)}(n)}catch{return n}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function x(n,e,t){let r="Unexpected state";typeof e=="string"?r=e:t=e,Al(n,r,t)}function Al(n,e,t){let r=`FIRESTORE (${_n}) INTERNAL ASSERTION FAILED: ${e} (ID: ${n.toString(16)})`;if(t!==void 0)try{r+=" CONTEXT: "+JSON.stringify(t)}catch{r+=" CONTEXT: "+t}throw nt(r),new Error(r)}function K(n,e,t,r){let s="Unexpected state";typeof t=="string"?s=t:r=t,n||Al(e,s,r)}function U(n,e){return n}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const S={OK:"ok",CANCELLED:"cancelled",UNKNOWN:"unknown",INVALID_ARGUMENT:"invalid-argument",DEADLINE_EXCEEDED:"deadline-exceeded",NOT_FOUND:"not-found",ALREADY_EXISTS:"already-exists",PERMISSION_DENIED:"permission-denied",UNAUTHENTICATED:"unauthenticated",RESOURCE_EXHAUSTED:"resource-exhausted",FAILED_PRECONDITION:"failed-precondition",ABORTED:"aborted",OUT_OF_RANGE:"out-of-range",UNIMPLEMENTED:"unimplemented",INTERNAL:"internal",UNAVAILABLE:"unavailable",DATA_LOSS:"data-loss"};class D extends it{constructor(e,t){super(e,t),this.code=e,this.message=t,this.toString=()=>`${this.name}: [code=${this.code}]: ${this.message}`}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Ye{constructor(){this.promise=new Promise((e,t)=>{this.resolve=e,this.reject=t})}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Rl{constructor(e,t){this.user=t,this.type="OAuth",this.headers=new Map,this.headers.set("Authorization",`Bearer ${e}`)}}class yg{getToken(){return Promise.resolve(null)}invalidateToken(){}start(e,t){e.enqueueRetryable(()=>t(Te.UNAUTHENTICATED))}shutdown(){}}class Eg{constructor(e){this.token=e,this.changeListener=null}getToken(){return Promise.resolve(this.token)}invalidateToken(){}start(e,t){this.changeListener=t,e.enqueueRetryable(()=>t(this.token.user))}shutdown(){this.changeListener=null}}class Tg{constructor(e){this.t=e,this.currentUser=Te.UNAUTHENTICATED,this.i=0,this.forceRefresh=!1,this.auth=null}start(e,t){K(this.o===void 0,42304);let r=this.i;const s=h=>this.i!==r?(r=this.i,t(h)):Promise.resolve();let o=new Ye;this.o=()=>{this.i++,this.currentUser=this.u(),o.resolve(),o=new Ye,e.enqueueRetryable(()=>s(this.currentUser))};const a=()=>{const h=o;e.enqueueRetryable(async()=>{await h.promise,await s(this.currentUser)})},u=h=>{N("FirebaseAuthCredentialsProvider","Auth detected"),this.auth=h,this.o&&(this.auth.addAuthTokenListener(this.o),a())};this.t.onInit(h=>u(h)),setTimeout(()=>{if(!this.auth){const h=this.t.getImmediate({optional:!0});h?u(h):(N("FirebaseAuthCredentialsProvider","Auth not yet detected"),o.resolve(),o=new Ye)}},0),a()}getToken(){const e=this.i,t=this.forceRefresh;return this.forceRefresh=!1,this.auth?this.auth.getToken(t).then(r=>this.i!==e?(N("FirebaseAuthCredentialsProvider","getToken aborted due to token change."),this.getToken()):r?(K(typeof r.accessToken=="string",31837,{l:r}),new Rl(r.accessToken,this.currentUser)):null):Promise.resolve(null)}invalidateToken(){this.forceRefresh=!0}shutdown(){this.auth&&this.o&&this.auth.removeAuthTokenListener(this.o),this.o=void 0}u(){const e=this.auth&&this.auth.getUid();return K(e===null||typeof e=="string",2055,{h:e}),new Te(e)}}class Ig{constructor(e,t,r){this.P=e,this.T=t,this.I=r,this.type="FirstParty",this.user=Te.FIRST_PARTY,this.A=new Map}R(){return this.I?this.I():null}get headers(){this.A.set("X-Goog-AuthUser",this.P);const e=this.R();return e&&this.A.set("Authorization",e),this.T&&this.A.set("X-Goog-Iam-Authorization-Token",this.T),this.A}}class vg{constructor(e,t,r){this.P=e,this.T=t,this.I=r}getToken(){return Promise.resolve(new Ig(this.P,this.T,this.I))}start(e,t){e.enqueueRetryable(()=>t(Te.FIRST_PARTY))}shutdown(){}invalidateToken(){}}class bc{constructor(e){this.value=e,this.type="AppCheck",this.headers=new Map,e&&e.length>0&&this.headers.set("x-firebase-appcheck",this.value)}}class wg{constructor(e,t){this.V=t,this.forceRefresh=!1,this.appCheck=null,this.m=null,this.p=null,Ne(e)&&e.settings.appCheckToken&&(this.p=e.settings.appCheckToken)}start(e,t){K(this.o===void 0,3512);const r=o=>{o.error!=null&&N("FirebaseAppCheckTokenProvider",`Error getting App Check token; using placeholder token instead. Error: ${o.error.message}`);const a=o.token!==this.m;return this.m=o.token,N("FirebaseAppCheckTokenProvider",`Received ${a?"new":"existing"} token.`),a?t(o.token):Promise.resolve()};this.o=o=>{e.enqueueRetryable(()=>r(o))};const s=o=>{N("FirebaseAppCheckTokenProvider","AppCheck detected"),this.appCheck=o,this.o&&this.appCheck.addTokenListener(this.o)};this.V.onInit(o=>s(o)),setTimeout(()=>{if(!this.appCheck){const o=this.V.getImmediate({optional:!0});o?s(o):N("FirebaseAppCheckTokenProvider","AppCheck not yet detected")}},0)}getToken(){if(this.p)return Promise.resolve(new bc(this.p));const e=this.forceRefresh;return this.forceRefresh=!1,this.appCheck?this.appCheck.getToken(e).then(t=>t?(K(typeof t.token=="string",44558,{tokenResult:t}),this.m=t.token,new bc(t.token)):null):Promise.resolve(null)}invalidateToken(){this.forceRefresh=!0}shutdown(){this.appCheck&&this.o&&this.appCheck.removeTokenListener(this.o),this.o=void 0}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Ag(n){const e=typeof self<"u"&&(self.crypto||self.msCrypto),t=new Uint8Array(n);if(e&&typeof e.getRandomValues=="function")e.getRandomValues(t);else for(let r=0;r<n;r++)t[r]=Math.floor(256*Math.random());return t}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class mo{static newId(){const e="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",t=62*Math.floor(4.129032258064516);let r="";for(;r.length<20;){const s=Ag(40);for(let o=0;o<s.length;++o)r.length<20&&s[o]<t&&(r+=e.charAt(s[o]%62))}return r}}function q(n,e){return n<e?-1:n>e?1:0}function xi(n,e){const t=Math.min(n.length,e.length);for(let r=0;r<t;r++){const s=n.charAt(r),o=e.charAt(r);if(s!==o)return vi(s)===vi(o)?q(s,o):vi(s)?1:-1}return q(n.length,e.length)}const Rg=55296,Sg=57343;function vi(n){const e=n.charCodeAt(0);return e>=Rg&&e<=Sg}function cn(n,e,t){return n.length===e.length&&n.every((r,s)=>t(r,e[s]))}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Vc="__name__";class Fe{constructor(e,t,r){t===void 0?t=0:t>e.length&&x(637,{offset:t,range:e.length}),r===void 0?r=e.length-t:r>e.length-t&&x(1746,{length:r,range:e.length-t}),this.segments=e,this.offset=t,this.len=r}get length(){return this.len}isEqual(e){return Fe.comparator(this,e)===0}child(e){const t=this.segments.slice(this.offset,this.limit());return e instanceof Fe?e.forEach(r=>{t.push(r)}):t.push(e),this.construct(t)}limit(){return this.offset+this.length}popFirst(e){return e=e===void 0?1:e,this.construct(this.segments,this.offset+e,this.length-e)}popLast(){return this.construct(this.segments,this.offset,this.length-1)}firstSegment(){return this.segments[this.offset]}lastSegment(){return this.get(this.length-1)}get(e){return this.segments[this.offset+e]}isEmpty(){return this.length===0}isPrefixOf(e){if(e.length<this.length)return!1;for(let t=0;t<this.length;t++)if(this.get(t)!==e.get(t))return!1;return!0}isImmediateParentOf(e){if(this.length+1!==e.length)return!1;for(let t=0;t<this.length;t++)if(this.get(t)!==e.get(t))return!1;return!0}forEach(e){for(let t=this.offset,r=this.limit();t<r;t++)e(this.segments[t])}toArray(){return this.segments.slice(this.offset,this.limit())}static comparator(e,t){const r=Math.min(e.length,t.length);for(let s=0;s<r;s++){const o=Fe.compareSegments(e.get(s),t.get(s));if(o!==0)return o}return q(e.length,t.length)}static compareSegments(e,t){const r=Fe.isNumericId(e),s=Fe.isNumericId(t);return r&&!s?-1:!r&&s?1:r&&s?Fe.extractNumericId(e).compare(Fe.extractNumericId(t)):xi(e,t)}static isNumericId(e){return e.startsWith("__id")&&e.endsWith("__")}static extractNumericId(e){return yt.fromString(e.substring(4,e.length-2))}}class J extends Fe{construct(e,t,r){return new J(e,t,r)}canonicalString(){return this.toArray().join("/")}toString(){return this.canonicalString()}toUriEncodedString(){return this.toArray().map(encodeURIComponent).join("/")}static fromString(...e){const t=[];for(const r of e){if(r.indexOf("//")>=0)throw new D(S.INVALID_ARGUMENT,`Invalid segment (${r}). Paths must not contain // in them.`);t.push(...r.split("/").filter(s=>s.length>0))}return new J(t)}static emptyPath(){return new J([])}}const Pg=/^[_a-zA-Z][_a-zA-Z0-9]*$/;class de extends Fe{construct(e,t,r){return new de(e,t,r)}static isValidIdentifier(e){return Pg.test(e)}canonicalString(){return this.toArray().map(e=>(e=e.replace(/\\/g,"\\\\").replace(/`/g,"\\`"),de.isValidIdentifier(e)||(e="`"+e+"`"),e)).join(".")}toString(){return this.canonicalString()}isKeyField(){return this.length===1&&this.get(0)===Vc}static keyField(){return new de([Vc])}static fromServerFormat(e){const t=[];let r="",s=0;const o=()=>{if(r.length===0)throw new D(S.INVALID_ARGUMENT,`Invalid field path (${e}). Paths must not be empty, begin with '.', end with '.', or contain '..'`);t.push(r),r=""};let a=!1;for(;s<e.length;){const u=e[s];if(u==="\\"){if(s+1===e.length)throw new D(S.INVALID_ARGUMENT,"Path has trailing escape character: "+e);const h=e[s+1];if(h!=="\\"&&h!=="."&&h!=="`")throw new D(S.INVALID_ARGUMENT,"Path has invalid escape sequence: "+e);r+=h,s+=2}else u==="`"?(a=!a,s++):u!=="."||a?(r+=u,s++):(o(),s++)}if(o(),a)throw new D(S.INVALID_ARGUMENT,"Unterminated ` in path: "+e);return new de(t)}static emptyPath(){return new de([])}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class M{constructor(e){this.path=e}static fromPath(e){return new M(J.fromString(e))}static fromName(e){return new M(J.fromString(e).popFirst(5))}static empty(){return new M(J.emptyPath())}get collectionGroup(){return this.path.popLast().lastSegment()}hasCollectionId(e){return this.path.length>=2&&this.path.get(this.path.length-2)===e}getCollectionGroup(){return this.path.get(this.path.length-2)}getCollectionPath(){return this.path.popLast()}isEqual(e){return e!==null&&J.comparator(this.path,e.path)===0}toString(){return this.path.toString()}static comparator(e,t){return J.comparator(e.path,t.path)}static isDocumentKey(e){return e.length%2==0}static fromSegments(e){return new M(new J(e.slice()))}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Sl(n,e,t){if(!t)throw new D(S.INVALID_ARGUMENT,`Function ${n}() cannot be called with an empty ${e}.`)}function Cg(n,e,t,r){if(e===!0&&r===!0)throw new D(S.INVALID_ARGUMENT,`${n} and ${t} cannot be used together.`)}function kc(n){if(!M.isDocumentKey(n))throw new D(S.INVALID_ARGUMENT,`Invalid document reference. Document references must have an even number of segments, but ${n} has ${n.length}.`)}function Dc(n){if(M.isDocumentKey(n))throw new D(S.INVALID_ARGUMENT,`Invalid collection reference. Collection references must have an odd number of segments, but ${n} has ${n.length}.`)}function Pl(n){return typeof n=="object"&&n!==null&&(Object.getPrototypeOf(n)===Object.prototype||Object.getPrototypeOf(n)===null)}function ws(n){if(n===void 0)return"undefined";if(n===null)return"null";if(typeof n=="string")return n.length>20&&(n=`${n.substring(0,20)}...`),JSON.stringify(n);if(typeof n=="number"||typeof n=="boolean")return""+n;if(typeof n=="object"){if(n instanceof Array)return"an array";{const e=function(r){return r.constructor?r.constructor.name:null}(n);return e?`a custom ${e} object`:"an object"}}return typeof n=="function"?"a function":x(12329,{type:typeof n})}function Pe(n,e){if("_delegate"in n&&(n=n._delegate),!(n instanceof e)){if(e.name===n.constructor.name)throw new D(S.INVALID_ARGUMENT,"Type does not match the expected instance. Did you pass a reference from a different Firestore SDK?");{const t=ws(n);throw new D(S.INVALID_ARGUMENT,`Expected type '${e.name}', but it was: ${t}`)}}return n}/**
 * @license
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function ie(n,e){const t={typeString:n};return e&&(t.value=e),t}function hr(n,e){if(!Pl(n))throw new D(S.INVALID_ARGUMENT,"JSON must be an object");let t;for(const r in e)if(e[r]){const s=e[r].typeString,o="value"in e[r]?{value:e[r].value}:void 0;if(!(r in n)){t=`JSON missing required field: '${r}'`;break}const a=n[r];if(s&&typeof a!==s){t=`JSON field '${r}' must be a ${s}.`;break}if(o!==void 0&&a!==o.value){t=`Expected '${r}' field to equal '${o.value}'`;break}}if(t)throw new D(S.INVALID_ARGUMENT,t);return!0}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Nc=-62135596800,Oc=1e6;class Y{static now(){return Y.fromMillis(Date.now())}static fromDate(e){return Y.fromMillis(e.getTime())}static fromMillis(e){const t=Math.floor(e/1e3),r=Math.floor((e-1e3*t)*Oc);return new Y(t,r)}constructor(e,t){if(this.seconds=e,this.nanoseconds=t,t<0)throw new D(S.INVALID_ARGUMENT,"Timestamp nanoseconds out of range: "+t);if(t>=1e9)throw new D(S.INVALID_ARGUMENT,"Timestamp nanoseconds out of range: "+t);if(e<Nc)throw new D(S.INVALID_ARGUMENT,"Timestamp seconds out of range: "+e);if(e>=253402300800)throw new D(S.INVALID_ARGUMENT,"Timestamp seconds out of range: "+e)}toDate(){return new Date(this.toMillis())}toMillis(){return 1e3*this.seconds+this.nanoseconds/Oc}_compareTo(e){return this.seconds===e.seconds?q(this.nanoseconds,e.nanoseconds):q(this.seconds,e.seconds)}isEqual(e){return e.seconds===this.seconds&&e.nanoseconds===this.nanoseconds}toString(){return"Timestamp(seconds="+this.seconds+", nanoseconds="+this.nanoseconds+")"}toJSON(){return{type:Y._jsonSchemaVersion,seconds:this.seconds,nanoseconds:this.nanoseconds}}static fromJSON(e){if(hr(e,Y._jsonSchema))return new Y(e.seconds,e.nanoseconds)}valueOf(){const e=this.seconds-Nc;return String(e).padStart(12,"0")+"."+String(this.nanoseconds).padStart(9,"0")}}Y._jsonSchemaVersion="firestore/timestamp/1.0",Y._jsonSchema={type:ie("string",Y._jsonSchemaVersion),seconds:ie("number"),nanoseconds:ie("number")};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class F{static fromTimestamp(e){return new F(e)}static min(){return new F(new Y(0,0))}static max(){return new F(new Y(253402300799,999999999))}constructor(e){this.timestamp=e}compareTo(e){return this.timestamp._compareTo(e.timestamp)}isEqual(e){return this.timestamp.isEqual(e.timestamp)}toMicroseconds(){return 1e6*this.timestamp.seconds+this.timestamp.nanoseconds/1e3}toString(){return"SnapshotVersion("+this.timestamp.toString()+")"}toTimestamp(){return this.timestamp}}/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Zn=-1;function bg(n,e){const t=n.toTimestamp().seconds,r=n.toTimestamp().nanoseconds+1,s=F.fromTimestamp(r===1e9?new Y(t+1,0):new Y(t,r));return new Tt(s,M.empty(),e)}function Vg(n){return new Tt(n.readTime,n.key,Zn)}class Tt{constructor(e,t,r){this.readTime=e,this.documentKey=t,this.largestBatchId=r}static min(){return new Tt(F.min(),M.empty(),Zn)}static max(){return new Tt(F.max(),M.empty(),Zn)}}function kg(n,e){let t=n.readTime.compareTo(e.readTime);return t!==0?t:(t=M.comparator(n.documentKey,e.documentKey),t!==0?t:q(n.largestBatchId,e.largestBatchId))}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Dg="The current tab is not in the required state to perform this operation. It might be necessary to refresh the browser tab.";class Ng{constructor(){this.onCommittedListeners=[]}addOnCommittedListener(e){this.onCommittedListeners.push(e)}raiseOnCommittedEvent(){this.onCommittedListeners.forEach(e=>e())}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */async function yn(n){if(n.code!==S.FAILED_PRECONDITION||n.message!==Dg)throw n;N("LocalStore","Unexpectedly lost primary lease")}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class P{constructor(e){this.nextCallback=null,this.catchCallback=null,this.result=void 0,this.error=void 0,this.isDone=!1,this.callbackAttached=!1,e(t=>{this.isDone=!0,this.result=t,this.nextCallback&&this.nextCallback(t)},t=>{this.isDone=!0,this.error=t,this.catchCallback&&this.catchCallback(t)})}catch(e){return this.next(void 0,e)}next(e,t){return this.callbackAttached&&x(59440),this.callbackAttached=!0,this.isDone?this.error?this.wrapFailure(t,this.error):this.wrapSuccess(e,this.result):new P((r,s)=>{this.nextCallback=o=>{this.wrapSuccess(e,o).next(r,s)},this.catchCallback=o=>{this.wrapFailure(t,o).next(r,s)}})}toPromise(){return new Promise((e,t)=>{this.next(e,t)})}wrapUserFunction(e){try{const t=e();return t instanceof P?t:P.resolve(t)}catch(t){return P.reject(t)}}wrapSuccess(e,t){return e?this.wrapUserFunction(()=>e(t)):P.resolve(t)}wrapFailure(e,t){return e?this.wrapUserFunction(()=>e(t)):P.reject(t)}static resolve(e){return new P((t,r)=>{t(e)})}static reject(e){return new P((t,r)=>{r(e)})}static waitFor(e){return new P((t,r)=>{let s=0,o=0,a=!1;e.forEach(u=>{++s,u.next(()=>{++o,a&&o===s&&t()},h=>r(h))}),a=!0,o===s&&t()})}static or(e){let t=P.resolve(!1);for(const r of e)t=t.next(s=>s?P.resolve(s):r());return t}static forEach(e,t){const r=[];return e.forEach((s,o)=>{r.push(t.call(this,s,o))}),this.waitFor(r)}static mapArray(e,t){return new P((r,s)=>{const o=e.length,a=new Array(o);let u=0;for(let h=0;h<o;h++){const d=h;t(e[d]).next(p=>{a[d]=p,++u,u===o&&r(a)},p=>s(p))}})}static doWhile(e,t){return new P((r,s)=>{const o=()=>{e()===!0?t().next(()=>{o()},s):r()};o()})}}function Og(n){const e=n.match(/Android ([\d.]+)/i),t=e?e[1].split(".").slice(0,2).join("."):"-1";return Number(t)}function En(n){return n.name==="IndexedDbTransactionError"}/**
 * @license
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class As{constructor(e,t){this.previousValue=e,t&&(t.sequenceNumberHandler=r=>this.ae(r),this.ue=r=>t.writeSequenceNumber(r))}ae(e){return this.previousValue=Math.max(e,this.previousValue),this.previousValue}next(){const e=++this.previousValue;return this.ue&&this.ue(e),e}}As.ce=-1;/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const go=-1;function Rs(n){return n==null}function cs(n){return n===0&&1/n==-1/0}function Mg(n){return typeof n=="number"&&Number.isInteger(n)&&!cs(n)&&n<=Number.MAX_SAFE_INTEGER&&n>=Number.MIN_SAFE_INTEGER}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Cl="";function Lg(n){let e="";for(let t=0;t<n.length;t++)e.length>0&&(e=Mc(e)),e=xg(n.get(t),e);return Mc(e)}function xg(n,e){let t=e;const r=n.length;for(let s=0;s<r;s++){const o=n.charAt(s);switch(o){case"\0":t+="";break;case Cl:t+="";break;default:t+=o}}return t}function Mc(n){return n+Cl+""}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Lc(n){let e=0;for(const t in n)Object.prototype.hasOwnProperty.call(n,t)&&e++;return e}function St(n,e){for(const t in n)Object.prototype.hasOwnProperty.call(n,t)&&e(t,n[t])}function bl(n){for(const e in n)if(Object.prototype.hasOwnProperty.call(n,e))return!1;return!0}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Z{constructor(e,t){this.comparator=e,this.root=t||he.EMPTY}insert(e,t){return new Z(this.comparator,this.root.insert(e,t,this.comparator).copy(null,null,he.BLACK,null,null))}remove(e){return new Z(this.comparator,this.root.remove(e,this.comparator).copy(null,null,he.BLACK,null,null))}get(e){let t=this.root;for(;!t.isEmpty();){const r=this.comparator(e,t.key);if(r===0)return t.value;r<0?t=t.left:r>0&&(t=t.right)}return null}indexOf(e){let t=0,r=this.root;for(;!r.isEmpty();){const s=this.comparator(e,r.key);if(s===0)return t+r.left.size;s<0?r=r.left:(t+=r.left.size+1,r=r.right)}return-1}isEmpty(){return this.root.isEmpty()}get size(){return this.root.size}minKey(){return this.root.minKey()}maxKey(){return this.root.maxKey()}inorderTraversal(e){return this.root.inorderTraversal(e)}forEach(e){this.inorderTraversal((t,r)=>(e(t,r),!1))}toString(){const e=[];return this.inorderTraversal((t,r)=>(e.push(`${t}:${r}`),!1)),`{${e.join(", ")}}`}reverseTraversal(e){return this.root.reverseTraversal(e)}getIterator(){return new Ur(this.root,null,this.comparator,!1)}getIteratorFrom(e){return new Ur(this.root,e,this.comparator,!1)}getReverseIterator(){return new Ur(this.root,null,this.comparator,!0)}getReverseIteratorFrom(e){return new Ur(this.root,e,this.comparator,!0)}}class Ur{constructor(e,t,r,s){this.isReverse=s,this.nodeStack=[];let o=1;for(;!e.isEmpty();)if(o=t?r(e.key,t):1,t&&s&&(o*=-1),o<0)e=this.isReverse?e.left:e.right;else{if(o===0){this.nodeStack.push(e);break}this.nodeStack.push(e),e=this.isReverse?e.right:e.left}}getNext(){let e=this.nodeStack.pop();const t={key:e.key,value:e.value};if(this.isReverse)for(e=e.left;!e.isEmpty();)this.nodeStack.push(e),e=e.right;else for(e=e.right;!e.isEmpty();)this.nodeStack.push(e),e=e.left;return t}hasNext(){return this.nodeStack.length>0}peek(){if(this.nodeStack.length===0)return null;const e=this.nodeStack[this.nodeStack.length-1];return{key:e.key,value:e.value}}}class he{constructor(e,t,r,s,o){this.key=e,this.value=t,this.color=r??he.RED,this.left=s??he.EMPTY,this.right=o??he.EMPTY,this.size=this.left.size+1+this.right.size}copy(e,t,r,s,o){return new he(e??this.key,t??this.value,r??this.color,s??this.left,o??this.right)}isEmpty(){return!1}inorderTraversal(e){return this.left.inorderTraversal(e)||e(this.key,this.value)||this.right.inorderTraversal(e)}reverseTraversal(e){return this.right.reverseTraversal(e)||e(this.key,this.value)||this.left.reverseTraversal(e)}min(){return this.left.isEmpty()?this:this.left.min()}minKey(){return this.min().key}maxKey(){return this.right.isEmpty()?this.key:this.right.maxKey()}insert(e,t,r){let s=this;const o=r(e,s.key);return s=o<0?s.copy(null,null,null,s.left.insert(e,t,r),null):o===0?s.copy(null,t,null,null,null):s.copy(null,null,null,null,s.right.insert(e,t,r)),s.fixUp()}removeMin(){if(this.left.isEmpty())return he.EMPTY;let e=this;return e.left.isRed()||e.left.left.isRed()||(e=e.moveRedLeft()),e=e.copy(null,null,null,e.left.removeMin(),null),e.fixUp()}remove(e,t){let r,s=this;if(t(e,s.key)<0)s.left.isEmpty()||s.left.isRed()||s.left.left.isRed()||(s=s.moveRedLeft()),s=s.copy(null,null,null,s.left.remove(e,t),null);else{if(s.left.isRed()&&(s=s.rotateRight()),s.right.isEmpty()||s.right.isRed()||s.right.left.isRed()||(s=s.moveRedRight()),t(e,s.key)===0){if(s.right.isEmpty())return he.EMPTY;r=s.right.min(),s=s.copy(r.key,r.value,null,null,s.right.removeMin())}s=s.copy(null,null,null,null,s.right.remove(e,t))}return s.fixUp()}isRed(){return this.color}fixUp(){let e=this;return e.right.isRed()&&!e.left.isRed()&&(e=e.rotateLeft()),e.left.isRed()&&e.left.left.isRed()&&(e=e.rotateRight()),e.left.isRed()&&e.right.isRed()&&(e=e.colorFlip()),e}moveRedLeft(){let e=this.colorFlip();return e.right.left.isRed()&&(e=e.copy(null,null,null,null,e.right.rotateRight()),e=e.rotateLeft(),e=e.colorFlip()),e}moveRedRight(){let e=this.colorFlip();return e.left.left.isRed()&&(e=e.rotateRight(),e=e.colorFlip()),e}rotateLeft(){const e=this.copy(null,null,he.RED,null,this.right.left);return this.right.copy(null,null,this.color,e,null)}rotateRight(){const e=this.copy(null,null,he.RED,this.left.right,null);return this.left.copy(null,null,this.color,null,e)}colorFlip(){const e=this.left.copy(null,null,!this.left.color,null,null),t=this.right.copy(null,null,!this.right.color,null,null);return this.copy(null,null,!this.color,e,t)}checkMaxDepth(){const e=this.check();return Math.pow(2,e)<=this.size+1}check(){if(this.isRed()&&this.left.isRed())throw x(43730,{key:this.key,value:this.value});if(this.right.isRed())throw x(14113,{key:this.key,value:this.value});const e=this.left.check();if(e!==this.right.check())throw x(27949);return e+(this.isRed()?0:1)}}he.EMPTY=null,he.RED=!0,he.BLACK=!1;he.EMPTY=new class{constructor(){this.size=0}get key(){throw x(57766)}get value(){throw x(16141)}get color(){throw x(16727)}get left(){throw x(29726)}get right(){throw x(36894)}copy(e,t,r,s,o){return this}insert(e,t,r){return new he(e,t)}remove(e,t){return this}isEmpty(){return!0}inorderTraversal(e){return!1}reverseTraversal(e){return!1}minKey(){return null}maxKey(){return null}isRed(){return!1}checkMaxDepth(){return!0}check(){return 0}};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class oe{constructor(e){this.comparator=e,this.data=new Z(this.comparator)}has(e){return this.data.get(e)!==null}first(){return this.data.minKey()}last(){return this.data.maxKey()}get size(){return this.data.size}indexOf(e){return this.data.indexOf(e)}forEach(e){this.data.inorderTraversal((t,r)=>(e(t),!1))}forEachInRange(e,t){const r=this.data.getIteratorFrom(e[0]);for(;r.hasNext();){const s=r.getNext();if(this.comparator(s.key,e[1])>=0)return;t(s.key)}}forEachWhile(e,t){let r;for(r=t!==void 0?this.data.getIteratorFrom(t):this.data.getIterator();r.hasNext();)if(!e(r.getNext().key))return}firstAfterOrEqual(e){const t=this.data.getIteratorFrom(e);return t.hasNext()?t.getNext().key:null}getIterator(){return new xc(this.data.getIterator())}getIteratorFrom(e){return new xc(this.data.getIteratorFrom(e))}add(e){return this.copy(this.data.remove(e).insert(e,!0))}delete(e){return this.has(e)?this.copy(this.data.remove(e)):this}isEmpty(){return this.data.isEmpty()}unionWith(e){let t=this;return t.size<e.size&&(t=e,e=this),e.forEach(r=>{t=t.add(r)}),t}isEqual(e){if(!(e instanceof oe)||this.size!==e.size)return!1;const t=this.data.getIterator(),r=e.data.getIterator();for(;t.hasNext();){const s=t.getNext().key,o=r.getNext().key;if(this.comparator(s,o)!==0)return!1}return!0}toArray(){const e=[];return this.forEach(t=>{e.push(t)}),e}toString(){const e=[];return this.forEach(t=>e.push(t)),"SortedSet("+e.toString()+")"}copy(e){const t=new oe(this.comparator);return t.data=e,t}}class xc{constructor(e){this.iter=e}getNext(){return this.iter.getNext().key}hasNext(){return this.iter.hasNext()}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class be{constructor(e){this.fields=e,e.sort(de.comparator)}static empty(){return new be([])}unionWith(e){let t=new oe(de.comparator);for(const r of this.fields)t=t.add(r);for(const r of e)t=t.add(r);return new be(t.toArray())}covers(e){for(const t of this.fields)if(t.isPrefixOf(e))return!0;return!1}isEqual(e){return cn(this.fields,e.fields,(t,r)=>t.isEqual(r))}}/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Vl extends Error{constructor(){super(...arguments),this.name="Base64DecodeError"}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class fe{constructor(e){this.binaryString=e}static fromBase64String(e){const t=function(s){try{return atob(s)}catch(o){throw typeof DOMException<"u"&&o instanceof DOMException?new Vl("Invalid base64 string: "+o):o}}(e);return new fe(t)}static fromUint8Array(e){const t=function(s){let o="";for(let a=0;a<s.length;++a)o+=String.fromCharCode(s[a]);return o}(e);return new fe(t)}[Symbol.iterator](){let e=0;return{next:()=>e<this.binaryString.length?{value:this.binaryString.charCodeAt(e++),done:!1}:{value:void 0,done:!0}}}toBase64(){return function(t){return btoa(t)}(this.binaryString)}toUint8Array(){return function(t){const r=new Uint8Array(t.length);for(let s=0;s<t.length;s++)r[s]=t.charCodeAt(s);return r}(this.binaryString)}approximateByteSize(){return 2*this.binaryString.length}compareTo(e){return q(this.binaryString,e.binaryString)}isEqual(e){return this.binaryString===e.binaryString}}fe.EMPTY_BYTE_STRING=new fe("");const Fg=new RegExp(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.(\d+))?Z$/);function It(n){if(K(!!n,39018),typeof n=="string"){let e=0;const t=Fg.exec(n);if(K(!!t,46558,{timestamp:n}),t[1]){let s=t[1];s=(s+"000000000").substr(0,9),e=Number(s)}const r=new Date(n);return{seconds:Math.floor(r.getTime()/1e3),nanos:e}}return{seconds:ne(n.seconds),nanos:ne(n.nanos)}}function ne(n){return typeof n=="number"?n:typeof n=="string"?Number(n):0}function vt(n){return typeof n=="string"?fe.fromBase64String(n):fe.fromUint8Array(n)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const kl="server_timestamp",Dl="__type__",Nl="__previous_value__",Ol="__local_write_time__";function _o(n){return(n?.mapValue?.fields||{})[Dl]?.stringValue===kl}function Ss(n){const e=n.mapValue.fields[Nl];return _o(e)?Ss(e):e}function er(n){const e=It(n.mapValue.fields[Ol].timestampValue);return new Y(e.seconds,e.nanos)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Ug{constructor(e,t,r,s,o,a,u,h,d,p){this.databaseId=e,this.appId=t,this.persistenceKey=r,this.host=s,this.ssl=o,this.forceLongPolling=a,this.autoDetectLongPolling=u,this.longPollingOptions=h,this.useFetchStreams=d,this.isUsingEmulator=p}}const us="(default)";class tr{constructor(e,t){this.projectId=e,this.database=t||us}static empty(){return new tr("","")}get isDefaultDatabase(){return this.database===us}isEqual(e){return e instanceof tr&&e.projectId===this.projectId&&e.database===this.database}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Ml="__type__",Bg="__max__",Br={mapValue:{}},Ll="__vector__",ls="value";function wt(n){return"nullValue"in n?0:"booleanValue"in n?1:"integerValue"in n||"doubleValue"in n?2:"timestampValue"in n?3:"stringValue"in n?5:"bytesValue"in n?6:"referenceValue"in n?7:"geoPointValue"in n?8:"arrayValue"in n?9:"mapValue"in n?_o(n)?4:qg(n)?9007199254740991:jg(n)?10:11:x(28295,{value:n})}function He(n,e){if(n===e)return!0;const t=wt(n);if(t!==wt(e))return!1;switch(t){case 0:case 9007199254740991:return!0;case 1:return n.booleanValue===e.booleanValue;case 4:return er(n).isEqual(er(e));case 3:return function(s,o){if(typeof s.timestampValue=="string"&&typeof o.timestampValue=="string"&&s.timestampValue.length===o.timestampValue.length)return s.timestampValue===o.timestampValue;const a=It(s.timestampValue),u=It(o.timestampValue);return a.seconds===u.seconds&&a.nanos===u.nanos}(n,e);case 5:return n.stringValue===e.stringValue;case 6:return function(s,o){return vt(s.bytesValue).isEqual(vt(o.bytesValue))}(n,e);case 7:return n.referenceValue===e.referenceValue;case 8:return function(s,o){return ne(s.geoPointValue.latitude)===ne(o.geoPointValue.latitude)&&ne(s.geoPointValue.longitude)===ne(o.geoPointValue.longitude)}(n,e);case 2:return function(s,o){if("integerValue"in s&&"integerValue"in o)return ne(s.integerValue)===ne(o.integerValue);if("doubleValue"in s&&"doubleValue"in o){const a=ne(s.doubleValue),u=ne(o.doubleValue);return a===u?cs(a)===cs(u):isNaN(a)&&isNaN(u)}return!1}(n,e);case 9:return cn(n.arrayValue.values||[],e.arrayValue.values||[],He);case 10:case 11:return function(s,o){const a=s.mapValue.fields||{},u=o.mapValue.fields||{};if(Lc(a)!==Lc(u))return!1;for(const h in a)if(a.hasOwnProperty(h)&&(u[h]===void 0||!He(a[h],u[h])))return!1;return!0}(n,e);default:return x(52216,{left:n})}}function nr(n,e){return(n.values||[]).find(t=>He(t,e))!==void 0}function un(n,e){if(n===e)return 0;const t=wt(n),r=wt(e);if(t!==r)return q(t,r);switch(t){case 0:case 9007199254740991:return 0;case 1:return q(n.booleanValue,e.booleanValue);case 2:return function(o,a){const u=ne(o.integerValue||o.doubleValue),h=ne(a.integerValue||a.doubleValue);return u<h?-1:u>h?1:u===h?0:isNaN(u)?isNaN(h)?0:-1:1}(n,e);case 3:return Fc(n.timestampValue,e.timestampValue);case 4:return Fc(er(n),er(e));case 5:return xi(n.stringValue,e.stringValue);case 6:return function(o,a){const u=vt(o),h=vt(a);return u.compareTo(h)}(n.bytesValue,e.bytesValue);case 7:return function(o,a){const u=o.split("/"),h=a.split("/");for(let d=0;d<u.length&&d<h.length;d++){const p=q(u[d],h[d]);if(p!==0)return p}return q(u.length,h.length)}(n.referenceValue,e.referenceValue);case 8:return function(o,a){const u=q(ne(o.latitude),ne(a.latitude));return u!==0?u:q(ne(o.longitude),ne(a.longitude))}(n.geoPointValue,e.geoPointValue);case 9:return Uc(n.arrayValue,e.arrayValue);case 10:return function(o,a){const u=o.fields||{},h=a.fields||{},d=u[ls]?.arrayValue,p=h[ls]?.arrayValue,y=q(d?.values?.length||0,p?.values?.length||0);return y!==0?y:Uc(d,p)}(n.mapValue,e.mapValue);case 11:return function(o,a){if(o===Br.mapValue&&a===Br.mapValue)return 0;if(o===Br.mapValue)return 1;if(a===Br.mapValue)return-1;const u=o.fields||{},h=Object.keys(u),d=a.fields||{},p=Object.keys(d);h.sort(),p.sort();for(let y=0;y<h.length&&y<p.length;++y){const E=xi(h[y],p[y]);if(E!==0)return E;const C=un(u[h[y]],d[p[y]]);if(C!==0)return C}return q(h.length,p.length)}(n.mapValue,e.mapValue);default:throw x(23264,{he:t})}}function Fc(n,e){if(typeof n=="string"&&typeof e=="string"&&n.length===e.length)return q(n,e);const t=It(n),r=It(e),s=q(t.seconds,r.seconds);return s!==0?s:q(t.nanos,r.nanos)}function Uc(n,e){const t=n.values||[],r=e.values||[];for(let s=0;s<t.length&&s<r.length;++s){const o=un(t[s],r[s]);if(o)return o}return q(t.length,r.length)}function ln(n){return Fi(n)}function Fi(n){return"nullValue"in n?"null":"booleanValue"in n?""+n.booleanValue:"integerValue"in n?""+n.integerValue:"doubleValue"in n?""+n.doubleValue:"timestampValue"in n?function(t){const r=It(t);return`time(${r.seconds},${r.nanos})`}(n.timestampValue):"stringValue"in n?n.stringValue:"bytesValue"in n?function(t){return vt(t).toBase64()}(n.bytesValue):"referenceValue"in n?function(t){return M.fromName(t).toString()}(n.referenceValue):"geoPointValue"in n?function(t){return`geo(${t.latitude},${t.longitude})`}(n.geoPointValue):"arrayValue"in n?function(t){let r="[",s=!0;for(const o of t.values||[])s?s=!1:r+=",",r+=Fi(o);return r+"]"}(n.arrayValue):"mapValue"in n?function(t){const r=Object.keys(t.fields||{}).sort();let s="{",o=!0;for(const a of r)o?o=!1:s+=",",s+=`${a}:${Fi(t.fields[a])}`;return s+"}"}(n.mapValue):x(61005,{value:n})}function Jr(n){switch(wt(n)){case 0:case 1:return 4;case 2:return 8;case 3:case 8:return 16;case 4:const e=Ss(n);return e?16+Jr(e):16;case 5:return 2*n.stringValue.length;case 6:return vt(n.bytesValue).approximateByteSize();case 7:return n.referenceValue.length;case 9:return function(r){return(r.values||[]).reduce((s,o)=>s+Jr(o),0)}(n.arrayValue);case 10:case 11:return function(r){let s=0;return St(r.fields,(o,a)=>{s+=o.length+Jr(a)}),s}(n.mapValue);default:throw x(13486,{value:n})}}function Bc(n,e){return{referenceValue:`projects/${n.projectId}/databases/${n.database}/documents/${e.path.canonicalString()}`}}function Ui(n){return!!n&&"integerValue"in n}function yo(n){return!!n&&"arrayValue"in n}function jc(n){return!!n&&"nullValue"in n}function qc(n){return!!n&&"doubleValue"in n&&isNaN(Number(n.doubleValue))}function Xr(n){return!!n&&"mapValue"in n}function jg(n){return(n?.mapValue?.fields||{})[Ml]?.stringValue===Ll}function Gn(n){if(n.geoPointValue)return{geoPointValue:{...n.geoPointValue}};if(n.timestampValue&&typeof n.timestampValue=="object")return{timestampValue:{...n.timestampValue}};if(n.mapValue){const e={mapValue:{fields:{}}};return St(n.mapValue.fields,(t,r)=>e.mapValue.fields[t]=Gn(r)),e}if(n.arrayValue){const e={arrayValue:{values:[]}};for(let t=0;t<(n.arrayValue.values||[]).length;++t)e.arrayValue.values[t]=Gn(n.arrayValue.values[t]);return e}return{...n}}function qg(n){return(((n.mapValue||{}).fields||{}).__type__||{}).stringValue===Bg}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Se{constructor(e){this.value=e}static empty(){return new Se({mapValue:{}})}field(e){if(e.isEmpty())return this.value;{let t=this.value;for(let r=0;r<e.length-1;++r)if(t=(t.mapValue.fields||{})[e.get(r)],!Xr(t))return null;return t=(t.mapValue.fields||{})[e.lastSegment()],t||null}}set(e,t){this.getFieldsMap(e.popLast())[e.lastSegment()]=Gn(t)}setAll(e){let t=de.emptyPath(),r={},s=[];e.forEach((a,u)=>{if(!t.isImmediateParentOf(u)){const h=this.getFieldsMap(t);this.applyChanges(h,r,s),r={},s=[],t=u.popLast()}a?r[u.lastSegment()]=Gn(a):s.push(u.lastSegment())});const o=this.getFieldsMap(t);this.applyChanges(o,r,s)}delete(e){const t=this.field(e.popLast());Xr(t)&&t.mapValue.fields&&delete t.mapValue.fields[e.lastSegment()]}isEqual(e){return He(this.value,e.value)}getFieldsMap(e){let t=this.value;t.mapValue.fields||(t.mapValue={fields:{}});for(let r=0;r<e.length;++r){let s=t.mapValue.fields[e.get(r)];Xr(s)&&s.mapValue.fields||(s={mapValue:{fields:{}}},t.mapValue.fields[e.get(r)]=s),t=s}return t.mapValue.fields}applyChanges(e,t,r){St(t,(s,o)=>e[s]=o);for(const s of r)delete e[s]}clone(){return new Se(Gn(this.value))}}function xl(n){const e=[];return St(n.fields,(t,r)=>{const s=new de([t]);if(Xr(r)){const o=xl(r.mapValue).fields;if(o.length===0)e.push(s);else for(const a of o)e.push(s.child(a))}else e.push(s)}),new be(e)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Ie{constructor(e,t,r,s,o,a,u){this.key=e,this.documentType=t,this.version=r,this.readTime=s,this.createTime=o,this.data=a,this.documentState=u}static newInvalidDocument(e){return new Ie(e,0,F.min(),F.min(),F.min(),Se.empty(),0)}static newFoundDocument(e,t,r,s){return new Ie(e,1,t,F.min(),r,s,0)}static newNoDocument(e,t){return new Ie(e,2,t,F.min(),F.min(),Se.empty(),0)}static newUnknownDocument(e,t){return new Ie(e,3,t,F.min(),F.min(),Se.empty(),2)}convertToFoundDocument(e,t){return!this.createTime.isEqual(F.min())||this.documentType!==2&&this.documentType!==0||(this.createTime=e),this.version=e,this.documentType=1,this.data=t,this.documentState=0,this}convertToNoDocument(e){return this.version=e,this.documentType=2,this.data=Se.empty(),this.documentState=0,this}convertToUnknownDocument(e){return this.version=e,this.documentType=3,this.data=Se.empty(),this.documentState=2,this}setHasCommittedMutations(){return this.documentState=2,this}setHasLocalMutations(){return this.documentState=1,this.version=F.min(),this}setReadTime(e){return this.readTime=e,this}get hasLocalMutations(){return this.documentState===1}get hasCommittedMutations(){return this.documentState===2}get hasPendingWrites(){return this.hasLocalMutations||this.hasCommittedMutations}isValidDocument(){return this.documentType!==0}isFoundDocument(){return this.documentType===1}isNoDocument(){return this.documentType===2}isUnknownDocument(){return this.documentType===3}isEqual(e){return e instanceof Ie&&this.key.isEqual(e.key)&&this.version.isEqual(e.version)&&this.documentType===e.documentType&&this.documentState===e.documentState&&this.data.isEqual(e.data)}mutableCopy(){return new Ie(this.key,this.documentType,this.version,this.readTime,this.createTime,this.data.clone(),this.documentState)}toString(){return`Document(${this.key}, ${this.version}, ${JSON.stringify(this.data.value)}, {createTime: ${this.createTime}}), {documentType: ${this.documentType}}), {documentState: ${this.documentState}})`}}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class hs{constructor(e,t){this.position=e,this.inclusive=t}}function $c(n,e,t){let r=0;for(let s=0;s<n.position.length;s++){const o=e[s],a=n.position[s];if(o.field.isKeyField()?r=M.comparator(M.fromName(a.referenceValue),t.key):r=un(a,t.data.field(o.field)),o.dir==="desc"&&(r*=-1),r!==0)break}return r}function zc(n,e){if(n===null)return e===null;if(e===null||n.inclusive!==e.inclusive||n.position.length!==e.position.length)return!1;for(let t=0;t<n.position.length;t++)if(!He(n.position[t],e.position[t]))return!1;return!0}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class rr{constructor(e,t="asc"){this.field=e,this.dir=t}}function $g(n,e){return n.dir===e.dir&&n.field.isEqual(e.field)}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Fl{}class se extends Fl{constructor(e,t,r){super(),this.field=e,this.op=t,this.value=r}static create(e,t,r){return e.isKeyField()?t==="in"||t==="not-in"?this.createKeyFieldInFilter(e,t,r):new Hg(e,t,r):t==="array-contains"?new Kg(e,r):t==="in"?new Qg(e,r):t==="not-in"?new Jg(e,r):t==="array-contains-any"?new Xg(e,r):new se(e,t,r)}static createKeyFieldInFilter(e,t,r){return t==="in"?new Gg(e,r):new Wg(e,r)}matches(e){const t=e.data.field(this.field);return this.op==="!="?t!==null&&t.nullValue===void 0&&this.matchesComparison(un(t,this.value)):t!==null&&wt(this.value)===wt(t)&&this.matchesComparison(un(t,this.value))}matchesComparison(e){switch(this.op){case"<":return e<0;case"<=":return e<=0;case"==":return e===0;case"!=":return e!==0;case">":return e>0;case">=":return e>=0;default:return x(47266,{operator:this.op})}}isInequality(){return["<","<=",">",">=","!=","not-in"].indexOf(this.op)>=0}getFlattenedFilters(){return[this]}getFilters(){return[this]}}class Le extends Fl{constructor(e,t){super(),this.filters=e,this.op=t,this.Pe=null}static create(e,t){return new Le(e,t)}matches(e){return Ul(this)?this.filters.find(t=>!t.matches(e))===void 0:this.filters.find(t=>t.matches(e))!==void 0}getFlattenedFilters(){return this.Pe!==null||(this.Pe=this.filters.reduce((e,t)=>e.concat(t.getFlattenedFilters()),[])),this.Pe}getFilters(){return Object.assign([],this.filters)}}function Ul(n){return n.op==="and"}function Bl(n){return zg(n)&&Ul(n)}function zg(n){for(const e of n.filters)if(e instanceof Le)return!1;return!0}function Bi(n){if(n instanceof se)return n.field.canonicalString()+n.op.toString()+ln(n.value);if(Bl(n))return n.filters.map(e=>Bi(e)).join(",");{const e=n.filters.map(t=>Bi(t)).join(",");return`${n.op}(${e})`}}function jl(n,e){return n instanceof se?function(r,s){return s instanceof se&&r.op===s.op&&r.field.isEqual(s.field)&&He(r.value,s.value)}(n,e):n instanceof Le?function(r,s){return s instanceof Le&&r.op===s.op&&r.filters.length===s.filters.length?r.filters.reduce((o,a,u)=>o&&jl(a,s.filters[u]),!0):!1}(n,e):void x(19439)}function ql(n){return n instanceof se?function(t){return`${t.field.canonicalString()} ${t.op} ${ln(t.value)}`}(n):n instanceof Le?function(t){return t.op.toString()+" {"+t.getFilters().map(ql).join(" ,")+"}"}(n):"Filter"}class Hg extends se{constructor(e,t,r){super(e,t,r),this.key=M.fromName(r.referenceValue)}matches(e){const t=M.comparator(e.key,this.key);return this.matchesComparison(t)}}class Gg extends se{constructor(e,t){super(e,"in",t),this.keys=$l("in",t)}matches(e){return this.keys.some(t=>t.isEqual(e.key))}}class Wg extends se{constructor(e,t){super(e,"not-in",t),this.keys=$l("not-in",t)}matches(e){return!this.keys.some(t=>t.isEqual(e.key))}}function $l(n,e){return(e.arrayValue?.values||[]).map(t=>M.fromName(t.referenceValue))}class Kg extends se{constructor(e,t){super(e,"array-contains",t)}matches(e){const t=e.data.field(this.field);return yo(t)&&nr(t.arrayValue,this.value)}}class Qg extends se{constructor(e,t){super(e,"in",t)}matches(e){const t=e.data.field(this.field);return t!==null&&nr(this.value.arrayValue,t)}}class Jg extends se{constructor(e,t){super(e,"not-in",t)}matches(e){if(nr(this.value.arrayValue,{nullValue:"NULL_VALUE"}))return!1;const t=e.data.field(this.field);return t!==null&&t.nullValue===void 0&&!nr(this.value.arrayValue,t)}}class Xg extends se{constructor(e,t){super(e,"array-contains-any",t)}matches(e){const t=e.data.field(this.field);return!(!yo(t)||!t.arrayValue.values)&&t.arrayValue.values.some(r=>nr(this.value.arrayValue,r))}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Yg{constructor(e,t=null,r=[],s=[],o=null,a=null,u=null){this.path=e,this.collectionGroup=t,this.orderBy=r,this.filters=s,this.limit=o,this.startAt=a,this.endAt=u,this.Te=null}}function Hc(n,e=null,t=[],r=[],s=null,o=null,a=null){return new Yg(n,e,t,r,s,o,a)}function Eo(n){const e=U(n);if(e.Te===null){let t=e.path.canonicalString();e.collectionGroup!==null&&(t+="|cg:"+e.collectionGroup),t+="|f:",t+=e.filters.map(r=>Bi(r)).join(","),t+="|ob:",t+=e.orderBy.map(r=>function(o){return o.field.canonicalString()+o.dir}(r)).join(","),Rs(e.limit)||(t+="|l:",t+=e.limit),e.startAt&&(t+="|lb:",t+=e.startAt.inclusive?"b:":"a:",t+=e.startAt.position.map(r=>ln(r)).join(",")),e.endAt&&(t+="|ub:",t+=e.endAt.inclusive?"a:":"b:",t+=e.endAt.position.map(r=>ln(r)).join(",")),e.Te=t}return e.Te}function To(n,e){if(n.limit!==e.limit||n.orderBy.length!==e.orderBy.length)return!1;for(let t=0;t<n.orderBy.length;t++)if(!$g(n.orderBy[t],e.orderBy[t]))return!1;if(n.filters.length!==e.filters.length)return!1;for(let t=0;t<n.filters.length;t++)if(!jl(n.filters[t],e.filters[t]))return!1;return n.collectionGroup===e.collectionGroup&&!!n.path.isEqual(e.path)&&!!zc(n.startAt,e.startAt)&&zc(n.endAt,e.endAt)}function ji(n){return M.isDocumentKey(n.path)&&n.collectionGroup===null&&n.filters.length===0}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Tn{constructor(e,t=null,r=[],s=[],o=null,a="F",u=null,h=null){this.path=e,this.collectionGroup=t,this.explicitOrderBy=r,this.filters=s,this.limit=o,this.limitType=a,this.startAt=u,this.endAt=h,this.Ie=null,this.Ee=null,this.de=null,this.startAt,this.endAt}}function Zg(n,e,t,r,s,o,a,u){return new Tn(n,e,t,r,s,o,a,u)}function Ps(n){return new Tn(n)}function Gc(n){return n.filters.length===0&&n.limit===null&&n.startAt==null&&n.endAt==null&&(n.explicitOrderBy.length===0||n.explicitOrderBy.length===1&&n.explicitOrderBy[0].field.isKeyField())}function zl(n){return n.collectionGroup!==null}function Wn(n){const e=U(n);if(e.Ie===null){e.Ie=[];const t=new Set;for(const o of e.explicitOrderBy)e.Ie.push(o),t.add(o.field.canonicalString());const r=e.explicitOrderBy.length>0?e.explicitOrderBy[e.explicitOrderBy.length-1].dir:"asc";(function(a){let u=new oe(de.comparator);return a.filters.forEach(h=>{h.getFlattenedFilters().forEach(d=>{d.isInequality()&&(u=u.add(d.field))})}),u})(e).forEach(o=>{t.has(o.canonicalString())||o.isKeyField()||e.Ie.push(new rr(o,r))}),t.has(de.keyField().canonicalString())||e.Ie.push(new rr(de.keyField(),r))}return e.Ie}function Be(n){const e=U(n);return e.Ee||(e.Ee=e_(e,Wn(n))),e.Ee}function e_(n,e){if(n.limitType==="F")return Hc(n.path,n.collectionGroup,e,n.filters,n.limit,n.startAt,n.endAt);{e=e.map(s=>{const o=s.dir==="desc"?"asc":"desc";return new rr(s.field,o)});const t=n.endAt?new hs(n.endAt.position,n.endAt.inclusive):null,r=n.startAt?new hs(n.startAt.position,n.startAt.inclusive):null;return Hc(n.path,n.collectionGroup,e,n.filters,n.limit,t,r)}}function qi(n,e){const t=n.filters.concat([e]);return new Tn(n.path,n.collectionGroup,n.explicitOrderBy.slice(),t,n.limit,n.limitType,n.startAt,n.endAt)}function $i(n,e,t){return new Tn(n.path,n.collectionGroup,n.explicitOrderBy.slice(),n.filters.slice(),e,t,n.startAt,n.endAt)}function Cs(n,e){return To(Be(n),Be(e))&&n.limitType===e.limitType}function Hl(n){return`${Eo(Be(n))}|lt:${n.limitType}`}function Xt(n){return`Query(target=${function(t){let r=t.path.canonicalString();return t.collectionGroup!==null&&(r+=" collectionGroup="+t.collectionGroup),t.filters.length>0&&(r+=`, filters: [${t.filters.map(s=>ql(s)).join(", ")}]`),Rs(t.limit)||(r+=", limit: "+t.limit),t.orderBy.length>0&&(r+=`, orderBy: [${t.orderBy.map(s=>function(a){return`${a.field.canonicalString()} (${a.dir})`}(s)).join(", ")}]`),t.startAt&&(r+=", startAt: ",r+=t.startAt.inclusive?"b:":"a:",r+=t.startAt.position.map(s=>ln(s)).join(",")),t.endAt&&(r+=", endAt: ",r+=t.endAt.inclusive?"a:":"b:",r+=t.endAt.position.map(s=>ln(s)).join(",")),`Target(${r})`}(Be(n))}; limitType=${n.limitType})`}function bs(n,e){return e.isFoundDocument()&&function(r,s){const o=s.key.path;return r.collectionGroup!==null?s.key.hasCollectionId(r.collectionGroup)&&r.path.isPrefixOf(o):M.isDocumentKey(r.path)?r.path.isEqual(o):r.path.isImmediateParentOf(o)}(n,e)&&function(r,s){for(const o of Wn(r))if(!o.field.isKeyField()&&s.data.field(o.field)===null)return!1;return!0}(n,e)&&function(r,s){for(const o of r.filters)if(!o.matches(s))return!1;return!0}(n,e)&&function(r,s){return!(r.startAt&&!function(a,u,h){const d=$c(a,u,h);return a.inclusive?d<=0:d<0}(r.startAt,Wn(r),s)||r.endAt&&!function(a,u,h){const d=$c(a,u,h);return a.inclusive?d>=0:d>0}(r.endAt,Wn(r),s))}(n,e)}function t_(n){return n.collectionGroup||(n.path.length%2==1?n.path.lastSegment():n.path.get(n.path.length-2))}function Gl(n){return(e,t)=>{let r=!1;for(const s of Wn(n)){const o=n_(s,e,t);if(o!==0)return o;r=r||s.field.isKeyField()}return 0}}function n_(n,e,t){const r=n.field.isKeyField()?M.comparator(e.key,t.key):function(o,a,u){const h=a.data.field(o),d=u.data.field(o);return h!==null&&d!==null?un(h,d):x(42886)}(n.field,e,t);switch(n.dir){case"asc":return r;case"desc":return-1*r;default:return x(19790,{direction:n.dir})}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class zt{constructor(e,t){this.mapKeyFn=e,this.equalsFn=t,this.inner={},this.innerSize=0}get(e){const t=this.mapKeyFn(e),r=this.inner[t];if(r!==void 0){for(const[s,o]of r)if(this.equalsFn(s,e))return o}}has(e){return this.get(e)!==void 0}set(e,t){const r=this.mapKeyFn(e),s=this.inner[r];if(s===void 0)return this.inner[r]=[[e,t]],void this.innerSize++;for(let o=0;o<s.length;o++)if(this.equalsFn(s[o][0],e))return void(s[o]=[e,t]);s.push([e,t]),this.innerSize++}delete(e){const t=this.mapKeyFn(e),r=this.inner[t];if(r===void 0)return!1;for(let s=0;s<r.length;s++)if(this.equalsFn(r[s][0],e))return r.length===1?delete this.inner[t]:r.splice(s,1),this.innerSize--,!0;return!1}forEach(e){St(this.inner,(t,r)=>{for(const[s,o]of r)e(s,o)})}isEmpty(){return bl(this.inner)}size(){return this.innerSize}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const r_=new Z(M.comparator);function rt(){return r_}const Wl=new Z(M.comparator);function Bn(...n){let e=Wl;for(const t of n)e=e.insert(t.key,t);return e}function Kl(n){let e=Wl;return n.forEach((t,r)=>e=e.insert(t,r.overlayedDocument)),e}function Lt(){return Kn()}function Ql(){return Kn()}function Kn(){return new zt(n=>n.toString(),(n,e)=>n.isEqual(e))}const s_=new Z(M.comparator),i_=new oe(M.comparator);function $(...n){let e=i_;for(const t of n)e=e.add(t);return e}const o_=new oe(q);function a_(){return o_}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Io(n,e){if(n.useProto3Json){if(isNaN(e))return{doubleValue:"NaN"};if(e===1/0)return{doubleValue:"Infinity"};if(e===-1/0)return{doubleValue:"-Infinity"}}return{doubleValue:cs(e)?"-0":e}}function Jl(n){return{integerValue:""+n}}function c_(n,e){return Mg(e)?Jl(e):Io(n,e)}/**
 * @license
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Vs{constructor(){this._=void 0}}function u_(n,e,t){return n instanceof sr?function(s,o){const a={fields:{[Dl]:{stringValue:kl},[Ol]:{timestampValue:{seconds:s.seconds,nanos:s.nanoseconds}}}};return o&&_o(o)&&(o=Ss(o)),o&&(a.fields[Nl]=o),{mapValue:a}}(t,e):n instanceof ir?Yl(n,e):n instanceof or?Zl(n,e):function(s,o){const a=Xl(s,o),u=Wc(a)+Wc(s.Ae);return Ui(a)&&Ui(s.Ae)?Jl(u):Io(s.serializer,u)}(n,e)}function l_(n,e,t){return n instanceof ir?Yl(n,e):n instanceof or?Zl(n,e):t}function Xl(n,e){return n instanceof ds?function(r){return Ui(r)||function(o){return!!o&&"doubleValue"in o}(r)}(e)?e:{integerValue:0}:null}class sr extends Vs{}class ir extends Vs{constructor(e){super(),this.elements=e}}function Yl(n,e){const t=eh(e);for(const r of n.elements)t.some(s=>He(s,r))||t.push(r);return{arrayValue:{values:t}}}class or extends Vs{constructor(e){super(),this.elements=e}}function Zl(n,e){let t=eh(e);for(const r of n.elements)t=t.filter(s=>!He(s,r));return{arrayValue:{values:t}}}class ds extends Vs{constructor(e,t){super(),this.serializer=e,this.Ae=t}}function Wc(n){return ne(n.integerValue||n.doubleValue)}function eh(n){return yo(n)&&n.arrayValue.values?n.arrayValue.values.slice():[]}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class h_{constructor(e,t){this.field=e,this.transform=t}}function d_(n,e){return n.field.isEqual(e.field)&&function(r,s){return r instanceof ir&&s instanceof ir||r instanceof or&&s instanceof or?cn(r.elements,s.elements,He):r instanceof ds&&s instanceof ds?He(r.Ae,s.Ae):r instanceof sr&&s instanceof sr}(n.transform,e.transform)}class f_{constructor(e,t){this.version=e,this.transformResults=t}}class ke{constructor(e,t){this.updateTime=e,this.exists=t}static none(){return new ke}static exists(e){return new ke(void 0,e)}static updateTime(e){return new ke(e)}get isNone(){return this.updateTime===void 0&&this.exists===void 0}isEqual(e){return this.exists===e.exists&&(this.updateTime?!!e.updateTime&&this.updateTime.isEqual(e.updateTime):!e.updateTime)}}function Yr(n,e){return n.updateTime!==void 0?e.isFoundDocument()&&e.version.isEqual(n.updateTime):n.exists===void 0||n.exists===e.isFoundDocument()}class ks{}function th(n,e){if(!n.hasLocalMutations||e&&e.fields.length===0)return null;if(e===null)return n.isNoDocument()?new vo(n.key,ke.none()):new dr(n.key,n.data,ke.none());{const t=n.data,r=Se.empty();let s=new oe(de.comparator);for(let o of e.fields)if(!s.has(o)){let a=t.field(o);a===null&&o.length>1&&(o=o.popLast(),a=t.field(o)),a===null?r.delete(o):r.set(o,a),s=s.add(o)}return new Pt(n.key,r,new be(s.toArray()),ke.none())}}function p_(n,e,t){n instanceof dr?function(s,o,a){const u=s.value.clone(),h=Qc(s.fieldTransforms,o,a.transformResults);u.setAll(h),o.convertToFoundDocument(a.version,u).setHasCommittedMutations()}(n,e,t):n instanceof Pt?function(s,o,a){if(!Yr(s.precondition,o))return void o.convertToUnknownDocument(a.version);const u=Qc(s.fieldTransforms,o,a.transformResults),h=o.data;h.setAll(nh(s)),h.setAll(u),o.convertToFoundDocument(a.version,h).setHasCommittedMutations()}(n,e,t):function(s,o,a){o.convertToNoDocument(a.version).setHasCommittedMutations()}(0,e,t)}function Qn(n,e,t,r){return n instanceof dr?function(o,a,u,h){if(!Yr(o.precondition,a))return u;const d=o.value.clone(),p=Jc(o.fieldTransforms,h,a);return d.setAll(p),a.convertToFoundDocument(a.version,d).setHasLocalMutations(),null}(n,e,t,r):n instanceof Pt?function(o,a,u,h){if(!Yr(o.precondition,a))return u;const d=Jc(o.fieldTransforms,h,a),p=a.data;return p.setAll(nh(o)),p.setAll(d),a.convertToFoundDocument(a.version,p).setHasLocalMutations(),u===null?null:u.unionWith(o.fieldMask.fields).unionWith(o.fieldTransforms.map(y=>y.field))}(n,e,t,r):function(o,a,u){return Yr(o.precondition,a)?(a.convertToNoDocument(a.version).setHasLocalMutations(),null):u}(n,e,t)}function m_(n,e){let t=null;for(const r of n.fieldTransforms){const s=e.data.field(r.field),o=Xl(r.transform,s||null);o!=null&&(t===null&&(t=Se.empty()),t.set(r.field,o))}return t||null}function Kc(n,e){return n.type===e.type&&!!n.key.isEqual(e.key)&&!!n.precondition.isEqual(e.precondition)&&!!function(r,s){return r===void 0&&s===void 0||!(!r||!s)&&cn(r,s,(o,a)=>d_(o,a))}(n.fieldTransforms,e.fieldTransforms)&&(n.type===0?n.value.isEqual(e.value):n.type!==1||n.data.isEqual(e.data)&&n.fieldMask.isEqual(e.fieldMask))}class dr extends ks{constructor(e,t,r,s=[]){super(),this.key=e,this.value=t,this.precondition=r,this.fieldTransforms=s,this.type=0}getFieldMask(){return null}}class Pt extends ks{constructor(e,t,r,s,o=[]){super(),this.key=e,this.data=t,this.fieldMask=r,this.precondition=s,this.fieldTransforms=o,this.type=1}getFieldMask(){return this.fieldMask}}function nh(n){const e=new Map;return n.fieldMask.fields.forEach(t=>{if(!t.isEmpty()){const r=n.data.field(t);e.set(t,r)}}),e}function Qc(n,e,t){const r=new Map;K(n.length===t.length,32656,{Re:t.length,Ve:n.length});for(let s=0;s<t.length;s++){const o=n[s],a=o.transform,u=e.data.field(o.field);r.set(o.field,l_(a,u,t[s]))}return r}function Jc(n,e,t){const r=new Map;for(const s of n){const o=s.transform,a=t.data.field(s.field);r.set(s.field,u_(o,a,e))}return r}class vo extends ks{constructor(e,t){super(),this.key=e,this.precondition=t,this.type=2,this.fieldTransforms=[]}getFieldMask(){return null}}class g_ extends ks{constructor(e,t){super(),this.key=e,this.precondition=t,this.type=3,this.fieldTransforms=[]}getFieldMask(){return null}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class __{constructor(e,t,r,s){this.batchId=e,this.localWriteTime=t,this.baseMutations=r,this.mutations=s}applyToRemoteDocument(e,t){const r=t.mutationResults;for(let s=0;s<this.mutations.length;s++){const o=this.mutations[s];o.key.isEqual(e.key)&&p_(o,e,r[s])}}applyToLocalView(e,t){for(const r of this.baseMutations)r.key.isEqual(e.key)&&(t=Qn(r,e,t,this.localWriteTime));for(const r of this.mutations)r.key.isEqual(e.key)&&(t=Qn(r,e,t,this.localWriteTime));return t}applyToLocalDocumentSet(e,t){const r=Ql();return this.mutations.forEach(s=>{const o=e.get(s.key),a=o.overlayedDocument;let u=this.applyToLocalView(a,o.mutatedFields);u=t.has(s.key)?null:u;const h=th(a,u);h!==null&&r.set(s.key,h),a.isValidDocument()||a.convertToNoDocument(F.min())}),r}keys(){return this.mutations.reduce((e,t)=>e.add(t.key),$())}isEqual(e){return this.batchId===e.batchId&&cn(this.mutations,e.mutations,(t,r)=>Kc(t,r))&&cn(this.baseMutations,e.baseMutations,(t,r)=>Kc(t,r))}}class wo{constructor(e,t,r,s){this.batch=e,this.commitVersion=t,this.mutationResults=r,this.docVersions=s}static from(e,t,r){K(e.mutations.length===r.length,58842,{me:e.mutations.length,fe:r.length});let s=function(){return s_}();const o=e.mutations;for(let a=0;a<o.length;a++)s=s.insert(o[a].key,r[a].version);return new wo(e,t,r,s)}}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class y_{constructor(e,t){this.largestBatchId=e,this.mutation=t}getKey(){return this.mutation.key}isEqual(e){return e!==null&&this.mutation===e.mutation}toString(){return`Overlay{
      largestBatchId: ${this.largestBatchId},
      mutation: ${this.mutation.toString()}
    }`}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class E_{constructor(e,t){this.count=e,this.unchangedNames=t}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */var re,G;function T_(n){switch(n){case S.OK:return x(64938);case S.CANCELLED:case S.UNKNOWN:case S.DEADLINE_EXCEEDED:case S.RESOURCE_EXHAUSTED:case S.INTERNAL:case S.UNAVAILABLE:case S.UNAUTHENTICATED:return!1;case S.INVALID_ARGUMENT:case S.NOT_FOUND:case S.ALREADY_EXISTS:case S.PERMISSION_DENIED:case S.FAILED_PRECONDITION:case S.ABORTED:case S.OUT_OF_RANGE:case S.UNIMPLEMENTED:case S.DATA_LOSS:return!0;default:return x(15467,{code:n})}}function rh(n){if(n===void 0)return nt("GRPC error has no .code"),S.UNKNOWN;switch(n){case re.OK:return S.OK;case re.CANCELLED:return S.CANCELLED;case re.UNKNOWN:return S.UNKNOWN;case re.DEADLINE_EXCEEDED:return S.DEADLINE_EXCEEDED;case re.RESOURCE_EXHAUSTED:return S.RESOURCE_EXHAUSTED;case re.INTERNAL:return S.INTERNAL;case re.UNAVAILABLE:return S.UNAVAILABLE;case re.UNAUTHENTICATED:return S.UNAUTHENTICATED;case re.INVALID_ARGUMENT:return S.INVALID_ARGUMENT;case re.NOT_FOUND:return S.NOT_FOUND;case re.ALREADY_EXISTS:return S.ALREADY_EXISTS;case re.PERMISSION_DENIED:return S.PERMISSION_DENIED;case re.FAILED_PRECONDITION:return S.FAILED_PRECONDITION;case re.ABORTED:return S.ABORTED;case re.OUT_OF_RANGE:return S.OUT_OF_RANGE;case re.UNIMPLEMENTED:return S.UNIMPLEMENTED;case re.DATA_LOSS:return S.DATA_LOSS;default:return x(39323,{code:n})}}(G=re||(re={}))[G.OK=0]="OK",G[G.CANCELLED=1]="CANCELLED",G[G.UNKNOWN=2]="UNKNOWN",G[G.INVALID_ARGUMENT=3]="INVALID_ARGUMENT",G[G.DEADLINE_EXCEEDED=4]="DEADLINE_EXCEEDED",G[G.NOT_FOUND=5]="NOT_FOUND",G[G.ALREADY_EXISTS=6]="ALREADY_EXISTS",G[G.PERMISSION_DENIED=7]="PERMISSION_DENIED",G[G.UNAUTHENTICATED=16]="UNAUTHENTICATED",G[G.RESOURCE_EXHAUSTED=8]="RESOURCE_EXHAUSTED",G[G.FAILED_PRECONDITION=9]="FAILED_PRECONDITION",G[G.ABORTED=10]="ABORTED",G[G.OUT_OF_RANGE=11]="OUT_OF_RANGE",G[G.UNIMPLEMENTED=12]="UNIMPLEMENTED",G[G.INTERNAL=13]="INTERNAL",G[G.UNAVAILABLE=14]="UNAVAILABLE",G[G.DATA_LOSS=15]="DATA_LOSS";/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function I_(){return new TextEncoder}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const v_=new yt([4294967295,4294967295],0);function Xc(n){const e=I_().encode(n),t=new yl;return t.update(e),new Uint8Array(t.digest())}function Yc(n){const e=new DataView(n.buffer),t=e.getUint32(0,!0),r=e.getUint32(4,!0),s=e.getUint32(8,!0),o=e.getUint32(12,!0);return[new yt([t,r],0),new yt([s,o],0)]}class Ao{constructor(e,t,r){if(this.bitmap=e,this.padding=t,this.hashCount=r,t<0||t>=8)throw new jn(`Invalid padding: ${t}`);if(r<0)throw new jn(`Invalid hash count: ${r}`);if(e.length>0&&this.hashCount===0)throw new jn(`Invalid hash count: ${r}`);if(e.length===0&&t!==0)throw new jn(`Invalid padding when bitmap length is 0: ${t}`);this.ge=8*e.length-t,this.pe=yt.fromNumber(this.ge)}ye(e,t,r){let s=e.add(t.multiply(yt.fromNumber(r)));return s.compare(v_)===1&&(s=new yt([s.getBits(0),s.getBits(1)],0)),s.modulo(this.pe).toNumber()}we(e){return!!(this.bitmap[Math.floor(e/8)]&1<<e%8)}mightContain(e){if(this.ge===0)return!1;const t=Xc(e),[r,s]=Yc(t);for(let o=0;o<this.hashCount;o++){const a=this.ye(r,s,o);if(!this.we(a))return!1}return!0}static create(e,t,r){const s=e%8==0?0:8-e%8,o=new Uint8Array(Math.ceil(e/8)),a=new Ao(o,s,t);return r.forEach(u=>a.insert(u)),a}insert(e){if(this.ge===0)return;const t=Xc(e),[r,s]=Yc(t);for(let o=0;o<this.hashCount;o++){const a=this.ye(r,s,o);this.Se(a)}}Se(e){const t=Math.floor(e/8),r=e%8;this.bitmap[t]|=1<<r}}class jn extends Error{constructor(){super(...arguments),this.name="BloomFilterError"}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Ds{constructor(e,t,r,s,o){this.snapshotVersion=e,this.targetChanges=t,this.targetMismatches=r,this.documentUpdates=s,this.resolvedLimboDocuments=o}static createSynthesizedRemoteEventForCurrentChange(e,t,r){const s=new Map;return s.set(e,fr.createSynthesizedTargetChangeForCurrentChange(e,t,r)),new Ds(F.min(),s,new Z(q),rt(),$())}}class fr{constructor(e,t,r,s,o){this.resumeToken=e,this.current=t,this.addedDocuments=r,this.modifiedDocuments=s,this.removedDocuments=o}static createSynthesizedTargetChangeForCurrentChange(e,t,r){return new fr(r,t,$(),$(),$())}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Zr{constructor(e,t,r,s){this.be=e,this.removedTargetIds=t,this.key=r,this.De=s}}class sh{constructor(e,t){this.targetId=e,this.Ce=t}}class ih{constructor(e,t,r=fe.EMPTY_BYTE_STRING,s=null){this.state=e,this.targetIds=t,this.resumeToken=r,this.cause=s}}class Zc{constructor(){this.ve=0,this.Fe=eu(),this.Me=fe.EMPTY_BYTE_STRING,this.xe=!1,this.Oe=!0}get current(){return this.xe}get resumeToken(){return this.Me}get Ne(){return this.ve!==0}get Be(){return this.Oe}Le(e){e.approximateByteSize()>0&&(this.Oe=!0,this.Me=e)}ke(){let e=$(),t=$(),r=$();return this.Fe.forEach((s,o)=>{switch(o){case 0:e=e.add(s);break;case 2:t=t.add(s);break;case 1:r=r.add(s);break;default:x(38017,{changeType:o})}}),new fr(this.Me,this.xe,e,t,r)}qe(){this.Oe=!1,this.Fe=eu()}Qe(e,t){this.Oe=!0,this.Fe=this.Fe.insert(e,t)}$e(e){this.Oe=!0,this.Fe=this.Fe.remove(e)}Ue(){this.ve+=1}Ke(){this.ve-=1,K(this.ve>=0,3241,{ve:this.ve})}We(){this.Oe=!0,this.xe=!0}}class w_{constructor(e){this.Ge=e,this.ze=new Map,this.je=rt(),this.Je=jr(),this.He=jr(),this.Ye=new Z(q)}Ze(e){for(const t of e.be)e.De&&e.De.isFoundDocument()?this.Xe(t,e.De):this.et(t,e.key,e.De);for(const t of e.removedTargetIds)this.et(t,e.key,e.De)}tt(e){this.forEachTarget(e,t=>{const r=this.nt(t);switch(e.state){case 0:this.rt(t)&&r.Le(e.resumeToken);break;case 1:r.Ke(),r.Ne||r.qe(),r.Le(e.resumeToken);break;case 2:r.Ke(),r.Ne||this.removeTarget(t);break;case 3:this.rt(t)&&(r.We(),r.Le(e.resumeToken));break;case 4:this.rt(t)&&(this.it(t),r.Le(e.resumeToken));break;default:x(56790,{state:e.state})}})}forEachTarget(e,t){e.targetIds.length>0?e.targetIds.forEach(t):this.ze.forEach((r,s)=>{this.rt(s)&&t(s)})}st(e){const t=e.targetId,r=e.Ce.count,s=this.ot(t);if(s){const o=s.target;if(ji(o))if(r===0){const a=new M(o.path);this.et(t,a,Ie.newNoDocument(a,F.min()))}else K(r===1,20013,{expectedCount:r});else{const a=this._t(t);if(a!==r){const u=this.ut(e),h=u?this.ct(u,e,a):1;if(h!==0){this.it(t);const d=h===2?"TargetPurposeExistenceFilterMismatchBloom":"TargetPurposeExistenceFilterMismatch";this.Ye=this.Ye.insert(t,d)}}}}}ut(e){const t=e.Ce.unchangedNames;if(!t||!t.bits)return null;const{bits:{bitmap:r="",padding:s=0},hashCount:o=0}=t;let a,u;try{a=vt(r).toUint8Array()}catch(h){if(h instanceof Vl)return an("Decoding the base64 bloom filter in existence filter failed ("+h.message+"); ignoring the bloom filter and falling back to full re-query."),null;throw h}try{u=new Ao(a,s,o)}catch(h){return an(h instanceof jn?"BloomFilter error: ":"Applying bloom filter failed: ",h),null}return u.ge===0?null:u}ct(e,t,r){return t.Ce.count===r-this.Pt(e,t.targetId)?0:2}Pt(e,t){const r=this.Ge.getRemoteKeysForTarget(t);let s=0;return r.forEach(o=>{const a=this.Ge.ht(),u=`projects/${a.projectId}/databases/${a.database}/documents/${o.path.canonicalString()}`;e.mightContain(u)||(this.et(t,o,null),s++)}),s}Tt(e){const t=new Map;this.ze.forEach((o,a)=>{const u=this.ot(a);if(u){if(o.current&&ji(u.target)){const h=new M(u.target.path);this.It(h).has(a)||this.Et(a,h)||this.et(a,h,Ie.newNoDocument(h,e))}o.Be&&(t.set(a,o.ke()),o.qe())}});let r=$();this.He.forEach((o,a)=>{let u=!0;a.forEachWhile(h=>{const d=this.ot(h);return!d||d.purpose==="TargetPurposeLimboResolution"||(u=!1,!1)}),u&&(r=r.add(o))}),this.je.forEach((o,a)=>a.setReadTime(e));const s=new Ds(e,t,this.Ye,this.je,r);return this.je=rt(),this.Je=jr(),this.He=jr(),this.Ye=new Z(q),s}Xe(e,t){if(!this.rt(e))return;const r=this.Et(e,t.key)?2:0;this.nt(e).Qe(t.key,r),this.je=this.je.insert(t.key,t),this.Je=this.Je.insert(t.key,this.It(t.key).add(e)),this.He=this.He.insert(t.key,this.dt(t.key).add(e))}et(e,t,r){if(!this.rt(e))return;const s=this.nt(e);this.Et(e,t)?s.Qe(t,1):s.$e(t),this.He=this.He.insert(t,this.dt(t).delete(e)),this.He=this.He.insert(t,this.dt(t).add(e)),r&&(this.je=this.je.insert(t,r))}removeTarget(e){this.ze.delete(e)}_t(e){const t=this.nt(e).ke();return this.Ge.getRemoteKeysForTarget(e).size+t.addedDocuments.size-t.removedDocuments.size}Ue(e){this.nt(e).Ue()}nt(e){let t=this.ze.get(e);return t||(t=new Zc,this.ze.set(e,t)),t}dt(e){let t=this.He.get(e);return t||(t=new oe(q),this.He=this.He.insert(e,t)),t}It(e){let t=this.Je.get(e);return t||(t=new oe(q),this.Je=this.Je.insert(e,t)),t}rt(e){const t=this.ot(e)!==null;return t||N("WatchChangeAggregator","Detected inactive target",e),t}ot(e){const t=this.ze.get(e);return t&&t.Ne?null:this.Ge.At(e)}it(e){this.ze.set(e,new Zc),this.Ge.getRemoteKeysForTarget(e).forEach(t=>{this.et(e,t,null)})}Et(e,t){return this.Ge.getRemoteKeysForTarget(e).has(t)}}function jr(){return new Z(M.comparator)}function eu(){return new Z(M.comparator)}const A_={asc:"ASCENDING",desc:"DESCENDING"},R_={"<":"LESS_THAN","<=":"LESS_THAN_OR_EQUAL",">":"GREATER_THAN",">=":"GREATER_THAN_OR_EQUAL","==":"EQUAL","!=":"NOT_EQUAL","array-contains":"ARRAY_CONTAINS",in:"IN","not-in":"NOT_IN","array-contains-any":"ARRAY_CONTAINS_ANY"},S_={and:"AND",or:"OR"};class P_{constructor(e,t){this.databaseId=e,this.useProto3Json=t}}function zi(n,e){return n.useProto3Json||Rs(e)?e:{value:e}}function fs(n,e){return n.useProto3Json?`${new Date(1e3*e.seconds).toISOString().replace(/\.\d*/,"").replace("Z","")}.${("000000000"+e.nanoseconds).slice(-9)}Z`:{seconds:""+e.seconds,nanos:e.nanoseconds}}function oh(n,e){return n.useProto3Json?e.toBase64():e.toUint8Array()}function C_(n,e){return fs(n,e.toTimestamp())}function je(n){return K(!!n,49232),F.fromTimestamp(function(t){const r=It(t);return new Y(r.seconds,r.nanos)}(n))}function Ro(n,e){return Hi(n,e).canonicalString()}function Hi(n,e){const t=function(s){return new J(["projects",s.projectId,"databases",s.database])}(n).child("documents");return e===void 0?t:t.child(e)}function ah(n){const e=J.fromString(n);return K(dh(e),10190,{key:e.toString()}),e}function Gi(n,e){return Ro(n.databaseId,e.path)}function wi(n,e){const t=ah(e);if(t.get(1)!==n.databaseId.projectId)throw new D(S.INVALID_ARGUMENT,"Tried to deserialize key from different project: "+t.get(1)+" vs "+n.databaseId.projectId);if(t.get(3)!==n.databaseId.database)throw new D(S.INVALID_ARGUMENT,"Tried to deserialize key from different database: "+t.get(3)+" vs "+n.databaseId.database);return new M(uh(t))}function ch(n,e){return Ro(n.databaseId,e)}function b_(n){const e=ah(n);return e.length===4?J.emptyPath():uh(e)}function Wi(n){return new J(["projects",n.databaseId.projectId,"databases",n.databaseId.database]).canonicalString()}function uh(n){return K(n.length>4&&n.get(4)==="documents",29091,{key:n.toString()}),n.popFirst(5)}function tu(n,e,t){return{name:Gi(n,e),fields:t.value.mapValue.fields}}function V_(n,e){let t;if("targetChange"in e){e.targetChange;const r=function(d){return d==="NO_CHANGE"?0:d==="ADD"?1:d==="REMOVE"?2:d==="CURRENT"?3:d==="RESET"?4:x(39313,{state:d})}(e.targetChange.targetChangeType||"NO_CHANGE"),s=e.targetChange.targetIds||[],o=function(d,p){return d.useProto3Json?(K(p===void 0||typeof p=="string",58123),fe.fromBase64String(p||"")):(K(p===void 0||p instanceof Buffer||p instanceof Uint8Array,16193),fe.fromUint8Array(p||new Uint8Array))}(n,e.targetChange.resumeToken),a=e.targetChange.cause,u=a&&function(d){const p=d.code===void 0?S.UNKNOWN:rh(d.code);return new D(p,d.message||"")}(a);t=new ih(r,s,o,u||null)}else if("documentChange"in e){e.documentChange;const r=e.documentChange;r.document,r.document.name,r.document.updateTime;const s=wi(n,r.document.name),o=je(r.document.updateTime),a=r.document.createTime?je(r.document.createTime):F.min(),u=new Se({mapValue:{fields:r.document.fields}}),h=Ie.newFoundDocument(s,o,a,u),d=r.targetIds||[],p=r.removedTargetIds||[];t=new Zr(d,p,h.key,h)}else if("documentDelete"in e){e.documentDelete;const r=e.documentDelete;r.document;const s=wi(n,r.document),o=r.readTime?je(r.readTime):F.min(),a=Ie.newNoDocument(s,o),u=r.removedTargetIds||[];t=new Zr([],u,a.key,a)}else if("documentRemove"in e){e.documentRemove;const r=e.documentRemove;r.document;const s=wi(n,r.document),o=r.removedTargetIds||[];t=new Zr([],o,s,null)}else{if(!("filter"in e))return x(11601,{Rt:e});{e.filter;const r=e.filter;r.targetId;const{count:s=0,unchangedNames:o}=r,a=new E_(s,o),u=r.targetId;t=new sh(u,a)}}return t}function k_(n,e){let t;if(e instanceof dr)t={update:tu(n,e.key,e.value)};else if(e instanceof vo)t={delete:Gi(n,e.key)};else if(e instanceof Pt)t={update:tu(n,e.key,e.data),updateMask:B_(e.fieldMask)};else{if(!(e instanceof g_))return x(16599,{Vt:e.type});t={verify:Gi(n,e.key)}}return e.fieldTransforms.length>0&&(t.updateTransforms=e.fieldTransforms.map(r=>function(o,a){const u=a.transform;if(u instanceof sr)return{fieldPath:a.field.canonicalString(),setToServerValue:"REQUEST_TIME"};if(u instanceof ir)return{fieldPath:a.field.canonicalString(),appendMissingElements:{values:u.elements}};if(u instanceof or)return{fieldPath:a.field.canonicalString(),removeAllFromArray:{values:u.elements}};if(u instanceof ds)return{fieldPath:a.field.canonicalString(),increment:u.Ae};throw x(20930,{transform:a.transform})}(0,r))),e.precondition.isNone||(t.currentDocument=function(s,o){return o.updateTime!==void 0?{updateTime:C_(s,o.updateTime)}:o.exists!==void 0?{exists:o.exists}:x(27497)}(n,e.precondition)),t}function D_(n,e){return n&&n.length>0?(K(e!==void 0,14353),n.map(t=>function(s,o){let a=s.updateTime?je(s.updateTime):je(o);return a.isEqual(F.min())&&(a=je(o)),new f_(a,s.transformResults||[])}(t,e))):[]}function N_(n,e){return{documents:[ch(n,e.path)]}}function O_(n,e){const t={structuredQuery:{}},r=e.path;let s;e.collectionGroup!==null?(s=r,t.structuredQuery.from=[{collectionId:e.collectionGroup,allDescendants:!0}]):(s=r.popLast(),t.structuredQuery.from=[{collectionId:r.lastSegment()}]),t.parent=ch(n,s);const o=function(d){if(d.length!==0)return hh(Le.create(d,"and"))}(e.filters);o&&(t.structuredQuery.where=o);const a=function(d){if(d.length!==0)return d.map(p=>function(E){return{field:Yt(E.field),direction:x_(E.dir)}}(p))}(e.orderBy);a&&(t.structuredQuery.orderBy=a);const u=zi(n,e.limit);return u!==null&&(t.structuredQuery.limit=u),e.startAt&&(t.structuredQuery.startAt=function(d){return{before:d.inclusive,values:d.position}}(e.startAt)),e.endAt&&(t.structuredQuery.endAt=function(d){return{before:!d.inclusive,values:d.position}}(e.endAt)),{ft:t,parent:s}}function M_(n){let e=b_(n.parent);const t=n.structuredQuery,r=t.from?t.from.length:0;let s=null;if(r>0){K(r===1,65062);const p=t.from[0];p.allDescendants?s=p.collectionId:e=e.child(p.collectionId)}let o=[];t.where&&(o=function(y){const E=lh(y);return E instanceof Le&&Bl(E)?E.getFilters():[E]}(t.where));let a=[];t.orderBy&&(a=function(y){return y.map(E=>function(b){return new rr(Zt(b.field),function(k){switch(k){case"ASCENDING":return"asc";case"DESCENDING":return"desc";default:return}}(b.direction))}(E))}(t.orderBy));let u=null;t.limit&&(u=function(y){let E;return E=typeof y=="object"?y.value:y,Rs(E)?null:E}(t.limit));let h=null;t.startAt&&(h=function(y){const E=!!y.before,C=y.values||[];return new hs(C,E)}(t.startAt));let d=null;return t.endAt&&(d=function(y){const E=!y.before,C=y.values||[];return new hs(C,E)}(t.endAt)),Zg(e,s,a,o,u,"F",h,d)}function L_(n,e){const t=function(s){switch(s){case"TargetPurposeListen":return null;case"TargetPurposeExistenceFilterMismatch":return"existence-filter-mismatch";case"TargetPurposeExistenceFilterMismatchBloom":return"existence-filter-mismatch-bloom";case"TargetPurposeLimboResolution":return"limbo-document";default:return x(28987,{purpose:s})}}(e.purpose);return t==null?null:{"goog-listen-tags":t}}function lh(n){return n.unaryFilter!==void 0?function(t){switch(t.unaryFilter.op){case"IS_NAN":const r=Zt(t.unaryFilter.field);return se.create(r,"==",{doubleValue:NaN});case"IS_NULL":const s=Zt(t.unaryFilter.field);return se.create(s,"==",{nullValue:"NULL_VALUE"});case"IS_NOT_NAN":const o=Zt(t.unaryFilter.field);return se.create(o,"!=",{doubleValue:NaN});case"IS_NOT_NULL":const a=Zt(t.unaryFilter.field);return se.create(a,"!=",{nullValue:"NULL_VALUE"});case"OPERATOR_UNSPECIFIED":return x(61313);default:return x(60726)}}(n):n.fieldFilter!==void 0?function(t){return se.create(Zt(t.fieldFilter.field),function(s){switch(s){case"EQUAL":return"==";case"NOT_EQUAL":return"!=";case"GREATER_THAN":return">";case"GREATER_THAN_OR_EQUAL":return">=";case"LESS_THAN":return"<";case"LESS_THAN_OR_EQUAL":return"<=";case"ARRAY_CONTAINS":return"array-contains";case"IN":return"in";case"NOT_IN":return"not-in";case"ARRAY_CONTAINS_ANY":return"array-contains-any";case"OPERATOR_UNSPECIFIED":return x(58110);default:return x(50506)}}(t.fieldFilter.op),t.fieldFilter.value)}(n):n.compositeFilter!==void 0?function(t){return Le.create(t.compositeFilter.filters.map(r=>lh(r)),function(s){switch(s){case"AND":return"and";case"OR":return"or";default:return x(1026)}}(t.compositeFilter.op))}(n):x(30097,{filter:n})}function x_(n){return A_[n]}function F_(n){return R_[n]}function U_(n){return S_[n]}function Yt(n){return{fieldPath:n.canonicalString()}}function Zt(n){return de.fromServerFormat(n.fieldPath)}function hh(n){return n instanceof se?function(t){if(t.op==="=="){if(qc(t.value))return{unaryFilter:{field:Yt(t.field),op:"IS_NAN"}};if(jc(t.value))return{unaryFilter:{field:Yt(t.field),op:"IS_NULL"}}}else if(t.op==="!="){if(qc(t.value))return{unaryFilter:{field:Yt(t.field),op:"IS_NOT_NAN"}};if(jc(t.value))return{unaryFilter:{field:Yt(t.field),op:"IS_NOT_NULL"}}}return{fieldFilter:{field:Yt(t.field),op:F_(t.op),value:t.value}}}(n):n instanceof Le?function(t){const r=t.getFilters().map(s=>hh(s));return r.length===1?r[0]:{compositeFilter:{op:U_(t.op),filters:r}}}(n):x(54877,{filter:n})}function B_(n){const e=[];return n.fields.forEach(t=>e.push(t.canonicalString())),{fieldPaths:e}}function dh(n){return n.length>=4&&n.get(0)==="projects"&&n.get(2)==="databases"}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class pt{constructor(e,t,r,s,o=F.min(),a=F.min(),u=fe.EMPTY_BYTE_STRING,h=null){this.target=e,this.targetId=t,this.purpose=r,this.sequenceNumber=s,this.snapshotVersion=o,this.lastLimboFreeSnapshotVersion=a,this.resumeToken=u,this.expectedCount=h}withSequenceNumber(e){return new pt(this.target,this.targetId,this.purpose,e,this.snapshotVersion,this.lastLimboFreeSnapshotVersion,this.resumeToken,this.expectedCount)}withResumeToken(e,t){return new pt(this.target,this.targetId,this.purpose,this.sequenceNumber,t,this.lastLimboFreeSnapshotVersion,e,null)}withExpectedCount(e){return new pt(this.target,this.targetId,this.purpose,this.sequenceNumber,this.snapshotVersion,this.lastLimboFreeSnapshotVersion,this.resumeToken,e)}withLastLimboFreeSnapshotVersion(e){return new pt(this.target,this.targetId,this.purpose,this.sequenceNumber,this.snapshotVersion,e,this.resumeToken,this.expectedCount)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class j_{constructor(e){this.yt=e}}function q_(n){const e=M_({parent:n.parent,structuredQuery:n.structuredQuery});return n.limitType==="LAST"?$i(e,e.limit,"L"):e}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class $_{constructor(){this.Cn=new z_}addToCollectionParentIndex(e,t){return this.Cn.add(t),P.resolve()}getCollectionParents(e,t){return P.resolve(this.Cn.getEntries(t))}addFieldIndex(e,t){return P.resolve()}deleteFieldIndex(e,t){return P.resolve()}deleteAllFieldIndexes(e){return P.resolve()}createTargetIndexes(e,t){return P.resolve()}getDocumentsMatchingTarget(e,t){return P.resolve(null)}getIndexType(e,t){return P.resolve(0)}getFieldIndexes(e,t){return P.resolve([])}getNextCollectionGroupToUpdate(e){return P.resolve(null)}getMinOffset(e,t){return P.resolve(Tt.min())}getMinOffsetFromCollectionGroup(e,t){return P.resolve(Tt.min())}updateCollectionGroup(e,t,r){return P.resolve()}updateIndexEntries(e,t){return P.resolve()}}class z_{constructor(){this.index={}}add(e){const t=e.lastSegment(),r=e.popLast(),s=this.index[t]||new oe(J.comparator),o=!s.has(r);return this.index[t]=s.add(r),o}has(e){const t=e.lastSegment(),r=e.popLast(),s=this.index[t];return s&&s.has(r)}getEntries(e){return(this.index[e]||new oe(J.comparator)).toArray()}}/**
 * @license
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const nu={didRun:!1,sequenceNumbersCollected:0,targetsRemoved:0,documentsRemoved:0},fh=41943040;class Re{static withCacheSize(e){return new Re(e,Re.DEFAULT_COLLECTION_PERCENTILE,Re.DEFAULT_MAX_SEQUENCE_NUMBERS_TO_COLLECT)}constructor(e,t,r){this.cacheSizeCollectionThreshold=e,this.percentileToCollect=t,this.maximumSequenceNumbersToCollect=r}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */Re.DEFAULT_COLLECTION_PERCENTILE=10,Re.DEFAULT_MAX_SEQUENCE_NUMBERS_TO_COLLECT=1e3,Re.DEFAULT=new Re(fh,Re.DEFAULT_COLLECTION_PERCENTILE,Re.DEFAULT_MAX_SEQUENCE_NUMBERS_TO_COLLECT),Re.DISABLED=new Re(-1,0,0);/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class hn{constructor(e){this.ar=e}next(){return this.ar+=2,this.ar}static ur(){return new hn(0)}static cr(){return new hn(-1)}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const ru="LruGarbageCollector",H_=1048576;function su([n,e],[t,r]){const s=q(n,t);return s===0?q(e,r):s}class G_{constructor(e){this.Ir=e,this.buffer=new oe(su),this.Er=0}dr(){return++this.Er}Ar(e){const t=[e,this.dr()];if(this.buffer.size<this.Ir)this.buffer=this.buffer.add(t);else{const r=this.buffer.last();su(t,r)<0&&(this.buffer=this.buffer.delete(r).add(t))}}get maxValue(){return this.buffer.last()[0]}}class W_{constructor(e,t,r){this.garbageCollector=e,this.asyncQueue=t,this.localStore=r,this.Rr=null}start(){this.garbageCollector.params.cacheSizeCollectionThreshold!==-1&&this.Vr(6e4)}stop(){this.Rr&&(this.Rr.cancel(),this.Rr=null)}get started(){return this.Rr!==null}Vr(e){N(ru,`Garbage collection scheduled in ${e}ms`),this.Rr=this.asyncQueue.enqueueAfterDelay("lru_garbage_collection",e,async()=>{this.Rr=null;try{await this.localStore.collectGarbage(this.garbageCollector)}catch(t){En(t)?N(ru,"Ignoring IndexedDB error during garbage collection: ",t):await yn(t)}await this.Vr(3e5)})}}class K_{constructor(e,t){this.mr=e,this.params=t}calculateTargetCount(e,t){return this.mr.gr(e).next(r=>Math.floor(t/100*r))}nthSequenceNumber(e,t){if(t===0)return P.resolve(As.ce);const r=new G_(t);return this.mr.forEachTarget(e,s=>r.Ar(s.sequenceNumber)).next(()=>this.mr.pr(e,s=>r.Ar(s))).next(()=>r.maxValue)}removeTargets(e,t,r){return this.mr.removeTargets(e,t,r)}removeOrphanedDocuments(e,t){return this.mr.removeOrphanedDocuments(e,t)}collect(e,t){return this.params.cacheSizeCollectionThreshold===-1?(N("LruGarbageCollector","Garbage collection skipped; disabled"),P.resolve(nu)):this.getCacheSize(e).next(r=>r<this.params.cacheSizeCollectionThreshold?(N("LruGarbageCollector",`Garbage collection skipped; Cache size ${r} is lower than threshold ${this.params.cacheSizeCollectionThreshold}`),nu):this.yr(e,t))}getCacheSize(e){return this.mr.getCacheSize(e)}yr(e,t){let r,s,o,a,u,h,d;const p=Date.now();return this.calculateTargetCount(e,this.params.percentileToCollect).next(y=>(y>this.params.maximumSequenceNumbersToCollect?(N("LruGarbageCollector",`Capping sequence numbers to collect down to the maximum of ${this.params.maximumSequenceNumbersToCollect} from ${y}`),s=this.params.maximumSequenceNumbersToCollect):s=y,a=Date.now(),this.nthSequenceNumber(e,s))).next(y=>(r=y,u=Date.now(),this.removeTargets(e,r,t))).next(y=>(o=y,h=Date.now(),this.removeOrphanedDocuments(e,r))).next(y=>(d=Date.now(),Jt()<=j.DEBUG&&N("LruGarbageCollector",`LRU Garbage Collection
	Counted targets in ${a-p}ms
	Determined least recently used ${s} in `+(u-a)+`ms
	Removed ${o} targets in `+(h-u)+`ms
	Removed ${y} documents in `+(d-h)+`ms
Total Duration: ${d-p}ms`),P.resolve({didRun:!0,sequenceNumbersCollected:s,targetsRemoved:o,documentsRemoved:y})))}}function Q_(n,e){return new K_(n,e)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class J_{constructor(){this.changes=new zt(e=>e.toString(),(e,t)=>e.isEqual(t)),this.changesApplied=!1}addEntry(e){this.assertNotApplied(),this.changes.set(e.key,e)}removeEntry(e,t){this.assertNotApplied(),this.changes.set(e,Ie.newInvalidDocument(e).setReadTime(t))}getEntry(e,t){this.assertNotApplied();const r=this.changes.get(t);return r!==void 0?P.resolve(r):this.getFromCache(e,t)}getEntries(e,t){return this.getAllFromCache(e,t)}apply(e){return this.assertNotApplied(),this.changesApplied=!0,this.applyChanges(e)}assertNotApplied(){}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *//**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class X_{constructor(e,t){this.overlayedDocument=e,this.mutatedFields=t}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Y_{constructor(e,t,r,s){this.remoteDocumentCache=e,this.mutationQueue=t,this.documentOverlayCache=r,this.indexManager=s}getDocument(e,t){let r=null;return this.documentOverlayCache.getOverlay(e,t).next(s=>(r=s,this.remoteDocumentCache.getEntry(e,t))).next(s=>(r!==null&&Qn(r.mutation,s,be.empty(),Y.now()),s))}getDocuments(e,t){return this.remoteDocumentCache.getEntries(e,t).next(r=>this.getLocalViewOfDocuments(e,r,$()).next(()=>r))}getLocalViewOfDocuments(e,t,r=$()){const s=Lt();return this.populateOverlays(e,s,t).next(()=>this.computeViews(e,t,s,r).next(o=>{let a=Bn();return o.forEach((u,h)=>{a=a.insert(u,h.overlayedDocument)}),a}))}getOverlayedDocuments(e,t){const r=Lt();return this.populateOverlays(e,r,t).next(()=>this.computeViews(e,t,r,$()))}populateOverlays(e,t,r){const s=[];return r.forEach(o=>{t.has(o)||s.push(o)}),this.documentOverlayCache.getOverlays(e,s).next(o=>{o.forEach((a,u)=>{t.set(a,u)})})}computeViews(e,t,r,s){let o=rt();const a=Kn(),u=function(){return Kn()}();return t.forEach((h,d)=>{const p=r.get(d.key);s.has(d.key)&&(p===void 0||p.mutation instanceof Pt)?o=o.insert(d.key,d):p!==void 0?(a.set(d.key,p.mutation.getFieldMask()),Qn(p.mutation,d,p.mutation.getFieldMask(),Y.now())):a.set(d.key,be.empty())}),this.recalculateAndSaveOverlays(e,o).next(h=>(h.forEach((d,p)=>a.set(d,p)),t.forEach((d,p)=>u.set(d,new X_(p,a.get(d)??null))),u))}recalculateAndSaveOverlays(e,t){const r=Kn();let s=new Z((a,u)=>a-u),o=$();return this.mutationQueue.getAllMutationBatchesAffectingDocumentKeys(e,t).next(a=>{for(const u of a)u.keys().forEach(h=>{const d=t.get(h);if(d===null)return;let p=r.get(h)||be.empty();p=u.applyToLocalView(d,p),r.set(h,p);const y=(s.get(u.batchId)||$()).add(h);s=s.insert(u.batchId,y)})}).next(()=>{const a=[],u=s.getReverseIterator();for(;u.hasNext();){const h=u.getNext(),d=h.key,p=h.value,y=Ql();p.forEach(E=>{if(!o.has(E)){const C=th(t.get(E),r.get(E));C!==null&&y.set(E,C),o=o.add(E)}}),a.push(this.documentOverlayCache.saveOverlays(e,d,y))}return P.waitFor(a)}).next(()=>r)}recalculateAndSaveOverlaysForDocumentKeys(e,t){return this.remoteDocumentCache.getEntries(e,t).next(r=>this.recalculateAndSaveOverlays(e,r))}getDocumentsMatchingQuery(e,t,r,s){return function(a){return M.isDocumentKey(a.path)&&a.collectionGroup===null&&a.filters.length===0}(t)?this.getDocumentsMatchingDocumentQuery(e,t.path):zl(t)?this.getDocumentsMatchingCollectionGroupQuery(e,t,r,s):this.getDocumentsMatchingCollectionQuery(e,t,r,s)}getNextDocuments(e,t,r,s){return this.remoteDocumentCache.getAllFromCollectionGroup(e,t,r,s).next(o=>{const a=s-o.size>0?this.documentOverlayCache.getOverlaysForCollectionGroup(e,t,r.largestBatchId,s-o.size):P.resolve(Lt());let u=Zn,h=o;return a.next(d=>P.forEach(d,(p,y)=>(u<y.largestBatchId&&(u=y.largestBatchId),o.get(p)?P.resolve():this.remoteDocumentCache.getEntry(e,p).next(E=>{h=h.insert(p,E)}))).next(()=>this.populateOverlays(e,d,o)).next(()=>this.computeViews(e,h,d,$())).next(p=>({batchId:u,changes:Kl(p)})))})}getDocumentsMatchingDocumentQuery(e,t){return this.getDocument(e,new M(t)).next(r=>{let s=Bn();return r.isFoundDocument()&&(s=s.insert(r.key,r)),s})}getDocumentsMatchingCollectionGroupQuery(e,t,r,s){const o=t.collectionGroup;let a=Bn();return this.indexManager.getCollectionParents(e,o).next(u=>P.forEach(u,h=>{const d=function(y,E){return new Tn(E,null,y.explicitOrderBy.slice(),y.filters.slice(),y.limit,y.limitType,y.startAt,y.endAt)}(t,h.child(o));return this.getDocumentsMatchingCollectionQuery(e,d,r,s).next(p=>{p.forEach((y,E)=>{a=a.insert(y,E)})})}).next(()=>a))}getDocumentsMatchingCollectionQuery(e,t,r,s){let o;return this.documentOverlayCache.getOverlaysForCollection(e,t.path,r.largestBatchId).next(a=>(o=a,this.remoteDocumentCache.getDocumentsMatchingQuery(e,t,r,o,s))).next(a=>{o.forEach((h,d)=>{const p=d.getKey();a.get(p)===null&&(a=a.insert(p,Ie.newInvalidDocument(p)))});let u=Bn();return a.forEach((h,d)=>{const p=o.get(h);p!==void 0&&Qn(p.mutation,d,be.empty(),Y.now()),bs(t,d)&&(u=u.insert(h,d))}),u})}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Z_{constructor(e){this.serializer=e,this.Lr=new Map,this.kr=new Map}getBundleMetadata(e,t){return P.resolve(this.Lr.get(t))}saveBundleMetadata(e,t){return this.Lr.set(t.id,function(s){return{id:s.id,version:s.version,createTime:je(s.createTime)}}(t)),P.resolve()}getNamedQuery(e,t){return P.resolve(this.kr.get(t))}saveNamedQuery(e,t){return this.kr.set(t.name,function(s){return{name:s.name,query:q_(s.bundledQuery),readTime:je(s.readTime)}}(t)),P.resolve()}}/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ey{constructor(){this.overlays=new Z(M.comparator),this.qr=new Map}getOverlay(e,t){return P.resolve(this.overlays.get(t))}getOverlays(e,t){const r=Lt();return P.forEach(t,s=>this.getOverlay(e,s).next(o=>{o!==null&&r.set(s,o)})).next(()=>r)}saveOverlays(e,t,r){return r.forEach((s,o)=>{this.St(e,t,o)}),P.resolve()}removeOverlaysForBatchId(e,t,r){const s=this.qr.get(r);return s!==void 0&&(s.forEach(o=>this.overlays=this.overlays.remove(o)),this.qr.delete(r)),P.resolve()}getOverlaysForCollection(e,t,r){const s=Lt(),o=t.length+1,a=new M(t.child("")),u=this.overlays.getIteratorFrom(a);for(;u.hasNext();){const h=u.getNext().value,d=h.getKey();if(!t.isPrefixOf(d.path))break;d.path.length===o&&h.largestBatchId>r&&s.set(h.getKey(),h)}return P.resolve(s)}getOverlaysForCollectionGroup(e,t,r,s){let o=new Z((d,p)=>d-p);const a=this.overlays.getIterator();for(;a.hasNext();){const d=a.getNext().value;if(d.getKey().getCollectionGroup()===t&&d.largestBatchId>r){let p=o.get(d.largestBatchId);p===null&&(p=Lt(),o=o.insert(d.largestBatchId,p)),p.set(d.getKey(),d)}}const u=Lt(),h=o.getIterator();for(;h.hasNext()&&(h.getNext().value.forEach((d,p)=>u.set(d,p)),!(u.size()>=s)););return P.resolve(u)}St(e,t,r){const s=this.overlays.get(r.key);if(s!==null){const a=this.qr.get(s.largestBatchId).delete(r.key);this.qr.set(s.largestBatchId,a)}this.overlays=this.overlays.insert(r.key,new y_(t,r));let o=this.qr.get(t);o===void 0&&(o=$(),this.qr.set(t,o)),this.qr.set(t,o.add(r.key))}}/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ty{constructor(){this.sessionToken=fe.EMPTY_BYTE_STRING}getSessionToken(e){return P.resolve(this.sessionToken)}setSessionToken(e,t){return this.sessionToken=t,P.resolve()}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class So{constructor(){this.Qr=new oe(ae.$r),this.Ur=new oe(ae.Kr)}isEmpty(){return this.Qr.isEmpty()}addReference(e,t){const r=new ae(e,t);this.Qr=this.Qr.add(r),this.Ur=this.Ur.add(r)}Wr(e,t){e.forEach(r=>this.addReference(r,t))}removeReference(e,t){this.Gr(new ae(e,t))}zr(e,t){e.forEach(r=>this.removeReference(r,t))}jr(e){const t=new M(new J([])),r=new ae(t,e),s=new ae(t,e+1),o=[];return this.Ur.forEachInRange([r,s],a=>{this.Gr(a),o.push(a.key)}),o}Jr(){this.Qr.forEach(e=>this.Gr(e))}Gr(e){this.Qr=this.Qr.delete(e),this.Ur=this.Ur.delete(e)}Hr(e){const t=new M(new J([])),r=new ae(t,e),s=new ae(t,e+1);let o=$();return this.Ur.forEachInRange([r,s],a=>{o=o.add(a.key)}),o}containsKey(e){const t=new ae(e,0),r=this.Qr.firstAfterOrEqual(t);return r!==null&&e.isEqual(r.key)}}class ae{constructor(e,t){this.key=e,this.Yr=t}static $r(e,t){return M.comparator(e.key,t.key)||q(e.Yr,t.Yr)}static Kr(e,t){return q(e.Yr,t.Yr)||M.comparator(e.key,t.key)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ny{constructor(e,t){this.indexManager=e,this.referenceDelegate=t,this.mutationQueue=[],this.tr=1,this.Zr=new oe(ae.$r)}checkEmpty(e){return P.resolve(this.mutationQueue.length===0)}addMutationBatch(e,t,r,s){const o=this.tr;this.tr++,this.mutationQueue.length>0&&this.mutationQueue[this.mutationQueue.length-1];const a=new __(o,t,r,s);this.mutationQueue.push(a);for(const u of s)this.Zr=this.Zr.add(new ae(u.key,o)),this.indexManager.addToCollectionParentIndex(e,u.key.path.popLast());return P.resolve(a)}lookupMutationBatch(e,t){return P.resolve(this.Xr(t))}getNextMutationBatchAfterBatchId(e,t){const r=t+1,s=this.ei(r),o=s<0?0:s;return P.resolve(this.mutationQueue.length>o?this.mutationQueue[o]:null)}getHighestUnacknowledgedBatchId(){return P.resolve(this.mutationQueue.length===0?go:this.tr-1)}getAllMutationBatches(e){return P.resolve(this.mutationQueue.slice())}getAllMutationBatchesAffectingDocumentKey(e,t){const r=new ae(t,0),s=new ae(t,Number.POSITIVE_INFINITY),o=[];return this.Zr.forEachInRange([r,s],a=>{const u=this.Xr(a.Yr);o.push(u)}),P.resolve(o)}getAllMutationBatchesAffectingDocumentKeys(e,t){let r=new oe(q);return t.forEach(s=>{const o=new ae(s,0),a=new ae(s,Number.POSITIVE_INFINITY);this.Zr.forEachInRange([o,a],u=>{r=r.add(u.Yr)})}),P.resolve(this.ti(r))}getAllMutationBatchesAffectingQuery(e,t){const r=t.path,s=r.length+1;let o=r;M.isDocumentKey(o)||(o=o.child(""));const a=new ae(new M(o),0);let u=new oe(q);return this.Zr.forEachWhile(h=>{const d=h.key.path;return!!r.isPrefixOf(d)&&(d.length===s&&(u=u.add(h.Yr)),!0)},a),P.resolve(this.ti(u))}ti(e){const t=[];return e.forEach(r=>{const s=this.Xr(r);s!==null&&t.push(s)}),t}removeMutationBatch(e,t){K(this.ni(t.batchId,"removed")===0,55003),this.mutationQueue.shift();let r=this.Zr;return P.forEach(t.mutations,s=>{const o=new ae(s.key,t.batchId);return r=r.delete(o),this.referenceDelegate.markPotentiallyOrphaned(e,s.key)}).next(()=>{this.Zr=r})}ir(e){}containsKey(e,t){const r=new ae(t,0),s=this.Zr.firstAfterOrEqual(r);return P.resolve(t.isEqual(s&&s.key))}performConsistencyCheck(e){return this.mutationQueue.length,P.resolve()}ni(e,t){return this.ei(e)}ei(e){return this.mutationQueue.length===0?0:e-this.mutationQueue[0].batchId}Xr(e){const t=this.ei(e);return t<0||t>=this.mutationQueue.length?null:this.mutationQueue[t]}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ry{constructor(e){this.ri=e,this.docs=function(){return new Z(M.comparator)}(),this.size=0}setIndexManager(e){this.indexManager=e}addEntry(e,t){const r=t.key,s=this.docs.get(r),o=s?s.size:0,a=this.ri(t);return this.docs=this.docs.insert(r,{document:t.mutableCopy(),size:a}),this.size+=a-o,this.indexManager.addToCollectionParentIndex(e,r.path.popLast())}removeEntry(e){const t=this.docs.get(e);t&&(this.docs=this.docs.remove(e),this.size-=t.size)}getEntry(e,t){const r=this.docs.get(t);return P.resolve(r?r.document.mutableCopy():Ie.newInvalidDocument(t))}getEntries(e,t){let r=rt();return t.forEach(s=>{const o=this.docs.get(s);r=r.insert(s,o?o.document.mutableCopy():Ie.newInvalidDocument(s))}),P.resolve(r)}getDocumentsMatchingQuery(e,t,r,s){let o=rt();const a=t.path,u=new M(a.child("__id-9223372036854775808__")),h=this.docs.getIteratorFrom(u);for(;h.hasNext();){const{key:d,value:{document:p}}=h.getNext();if(!a.isPrefixOf(d.path))break;d.path.length>a.length+1||kg(Vg(p),r)<=0||(s.has(p.key)||bs(t,p))&&(o=o.insert(p.key,p.mutableCopy()))}return P.resolve(o)}getAllFromCollectionGroup(e,t,r,s){x(9500)}ii(e,t){return P.forEach(this.docs,r=>t(r))}newChangeBuffer(e){return new sy(this)}getSize(e){return P.resolve(this.size)}}class sy extends J_{constructor(e){super(),this.Nr=e}applyChanges(e){const t=[];return this.changes.forEach((r,s)=>{s.isValidDocument()?t.push(this.Nr.addEntry(e,s)):this.Nr.removeEntry(r)}),P.waitFor(t)}getFromCache(e,t){return this.Nr.getEntry(e,t)}getAllFromCache(e,t){return this.Nr.getEntries(e,t)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class iy{constructor(e){this.persistence=e,this.si=new zt(t=>Eo(t),To),this.lastRemoteSnapshotVersion=F.min(),this.highestTargetId=0,this.oi=0,this._i=new So,this.targetCount=0,this.ai=hn.ur()}forEachTarget(e,t){return this.si.forEach((r,s)=>t(s)),P.resolve()}getLastRemoteSnapshotVersion(e){return P.resolve(this.lastRemoteSnapshotVersion)}getHighestSequenceNumber(e){return P.resolve(this.oi)}allocateTargetId(e){return this.highestTargetId=this.ai.next(),P.resolve(this.highestTargetId)}setTargetsMetadata(e,t,r){return r&&(this.lastRemoteSnapshotVersion=r),t>this.oi&&(this.oi=t),P.resolve()}Pr(e){this.si.set(e.target,e);const t=e.targetId;t>this.highestTargetId&&(this.ai=new hn(t),this.highestTargetId=t),e.sequenceNumber>this.oi&&(this.oi=e.sequenceNumber)}addTargetData(e,t){return this.Pr(t),this.targetCount+=1,P.resolve()}updateTargetData(e,t){return this.Pr(t),P.resolve()}removeTargetData(e,t){return this.si.delete(t.target),this._i.jr(t.targetId),this.targetCount-=1,P.resolve()}removeTargets(e,t,r){let s=0;const o=[];return this.si.forEach((a,u)=>{u.sequenceNumber<=t&&r.get(u.targetId)===null&&(this.si.delete(a),o.push(this.removeMatchingKeysForTargetId(e,u.targetId)),s++)}),P.waitFor(o).next(()=>s)}getTargetCount(e){return P.resolve(this.targetCount)}getTargetData(e,t){const r=this.si.get(t)||null;return P.resolve(r)}addMatchingKeys(e,t,r){return this._i.Wr(t,r),P.resolve()}removeMatchingKeys(e,t,r){this._i.zr(t,r);const s=this.persistence.referenceDelegate,o=[];return s&&t.forEach(a=>{o.push(s.markPotentiallyOrphaned(e,a))}),P.waitFor(o)}removeMatchingKeysForTargetId(e,t){return this._i.jr(t),P.resolve()}getMatchingKeysForTargetId(e,t){const r=this._i.Hr(t);return P.resolve(r)}containsKey(e,t){return P.resolve(this._i.containsKey(t))}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ph{constructor(e,t){this.ui={},this.overlays={},this.ci=new As(0),this.li=!1,this.li=!0,this.hi=new ty,this.referenceDelegate=e(this),this.Pi=new iy(this),this.indexManager=new $_,this.remoteDocumentCache=function(s){return new ry(s)}(r=>this.referenceDelegate.Ti(r)),this.serializer=new j_(t),this.Ii=new Z_(this.serializer)}start(){return Promise.resolve()}shutdown(){return this.li=!1,Promise.resolve()}get started(){return this.li}setDatabaseDeletedListener(){}setNetworkEnabled(){}getIndexManager(e){return this.indexManager}getDocumentOverlayCache(e){let t=this.overlays[e.toKey()];return t||(t=new ey,this.overlays[e.toKey()]=t),t}getMutationQueue(e,t){let r=this.ui[e.toKey()];return r||(r=new ny(t,this.referenceDelegate),this.ui[e.toKey()]=r),r}getGlobalsCache(){return this.hi}getTargetCache(){return this.Pi}getRemoteDocumentCache(){return this.remoteDocumentCache}getBundleCache(){return this.Ii}runTransaction(e,t,r){N("MemoryPersistence","Starting transaction:",e);const s=new oy(this.ci.next());return this.referenceDelegate.Ei(),r(s).next(o=>this.referenceDelegate.di(s).next(()=>o)).toPromise().then(o=>(s.raiseOnCommittedEvent(),o))}Ai(e,t){return P.or(Object.values(this.ui).map(r=>()=>r.containsKey(e,t)))}}class oy extends Ng{constructor(e){super(),this.currentSequenceNumber=e}}class Po{constructor(e){this.persistence=e,this.Ri=new So,this.Vi=null}static mi(e){return new Po(e)}get fi(){if(this.Vi)return this.Vi;throw x(60996)}addReference(e,t,r){return this.Ri.addReference(r,t),this.fi.delete(r.toString()),P.resolve()}removeReference(e,t,r){return this.Ri.removeReference(r,t),this.fi.add(r.toString()),P.resolve()}markPotentiallyOrphaned(e,t){return this.fi.add(t.toString()),P.resolve()}removeTarget(e,t){this.Ri.jr(t.targetId).forEach(s=>this.fi.add(s.toString()));const r=this.persistence.getTargetCache();return r.getMatchingKeysForTargetId(e,t.targetId).next(s=>{s.forEach(o=>this.fi.add(o.toString()))}).next(()=>r.removeTargetData(e,t))}Ei(){this.Vi=new Set}di(e){const t=this.persistence.getRemoteDocumentCache().newChangeBuffer();return P.forEach(this.fi,r=>{const s=M.fromPath(r);return this.gi(e,s).next(o=>{o||t.removeEntry(s,F.min())})}).next(()=>(this.Vi=null,t.apply(e)))}updateLimboDocument(e,t){return this.gi(e,t).next(r=>{r?this.fi.delete(t.toString()):this.fi.add(t.toString())})}Ti(e){return 0}gi(e,t){return P.or([()=>P.resolve(this.Ri.containsKey(t)),()=>this.persistence.getTargetCache().containsKey(e,t),()=>this.persistence.Ai(e,t)])}}class ps{constructor(e,t){this.persistence=e,this.pi=new zt(r=>Lg(r.path),(r,s)=>r.isEqual(s)),this.garbageCollector=Q_(this,t)}static mi(e,t){return new ps(e,t)}Ei(){}di(e){return P.resolve()}forEachTarget(e,t){return this.persistence.getTargetCache().forEachTarget(e,t)}gr(e){const t=this.wr(e);return this.persistence.getTargetCache().getTargetCount(e).next(r=>t.next(s=>r+s))}wr(e){let t=0;return this.pr(e,r=>{t++}).next(()=>t)}pr(e,t){return P.forEach(this.pi,(r,s)=>this.br(e,r,s).next(o=>o?P.resolve():t(s)))}removeTargets(e,t,r){return this.persistence.getTargetCache().removeTargets(e,t,r)}removeOrphanedDocuments(e,t){let r=0;const s=this.persistence.getRemoteDocumentCache(),o=s.newChangeBuffer();return s.ii(e,a=>this.br(e,a,t).next(u=>{u||(r++,o.removeEntry(a,F.min()))})).next(()=>o.apply(e)).next(()=>r)}markPotentiallyOrphaned(e,t){return this.pi.set(t,e.currentSequenceNumber),P.resolve()}removeTarget(e,t){const r=t.withSequenceNumber(e.currentSequenceNumber);return this.persistence.getTargetCache().updateTargetData(e,r)}addReference(e,t,r){return this.pi.set(r,e.currentSequenceNumber),P.resolve()}removeReference(e,t,r){return this.pi.set(r,e.currentSequenceNumber),P.resolve()}updateLimboDocument(e,t){return this.pi.set(t,e.currentSequenceNumber),P.resolve()}Ti(e){let t=e.key.toString().length;return e.isFoundDocument()&&(t+=Jr(e.data.value)),t}br(e,t,r){return P.or([()=>this.persistence.Ai(e,t),()=>this.persistence.getTargetCache().containsKey(e,t),()=>{const s=this.pi.get(t);return P.resolve(s!==void 0&&s>r)}])}getCacheSize(e){return this.persistence.getRemoteDocumentCache().getSize(e)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Co{constructor(e,t,r,s){this.targetId=e,this.fromCache=t,this.Es=r,this.ds=s}static As(e,t){let r=$(),s=$();for(const o of t.docChanges)switch(o.type){case 0:r=r.add(o.doc.key);break;case 1:s=s.add(o.doc.key)}return new Co(e,t.fromCache,r,s)}}/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class ay{constructor(){this._documentReadCount=0}get documentReadCount(){return this._documentReadCount}incrementDocumentReadCount(e){this._documentReadCount+=e}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class cy{constructor(){this.Rs=!1,this.Vs=!1,this.fs=100,this.gs=function(){return Zd()?8:Og(ve())>0?6:4}()}initialize(e,t){this.ps=e,this.indexManager=t,this.Rs=!0}getDocumentsMatchingQuery(e,t,r,s){const o={result:null};return this.ys(e,t).next(a=>{o.result=a}).next(()=>{if(!o.result)return this.ws(e,t,s,r).next(a=>{o.result=a})}).next(()=>{if(o.result)return;const a=new ay;return this.Ss(e,t,a).next(u=>{if(o.result=u,this.Vs)return this.bs(e,t,a,u.size)})}).next(()=>o.result)}bs(e,t,r,s){return r.documentReadCount<this.fs?(Jt()<=j.DEBUG&&N("QueryEngine","SDK will not create cache indexes for query:",Xt(t),"since it only creates cache indexes for collection contains","more than or equal to",this.fs,"documents"),P.resolve()):(Jt()<=j.DEBUG&&N("QueryEngine","Query:",Xt(t),"scans",r.documentReadCount,"local documents and returns",s,"documents as results."),r.documentReadCount>this.gs*s?(Jt()<=j.DEBUG&&N("QueryEngine","The SDK decides to create cache indexes for query:",Xt(t),"as using cache indexes may help improve performance."),this.indexManager.createTargetIndexes(e,Be(t))):P.resolve())}ys(e,t){if(Gc(t))return P.resolve(null);let r=Be(t);return this.indexManager.getIndexType(e,r).next(s=>s===0?null:(t.limit!==null&&s===1&&(t=$i(t,null,"F"),r=Be(t)),this.indexManager.getDocumentsMatchingTarget(e,r).next(o=>{const a=$(...o);return this.ps.getDocuments(e,a).next(u=>this.indexManager.getMinOffset(e,r).next(h=>{const d=this.Ds(t,u);return this.Cs(t,d,a,h.readTime)?this.ys(e,$i(t,null,"F")):this.vs(e,d,t,h)}))})))}ws(e,t,r,s){return Gc(t)||s.isEqual(F.min())?P.resolve(null):this.ps.getDocuments(e,r).next(o=>{const a=this.Ds(t,o);return this.Cs(t,a,r,s)?P.resolve(null):(Jt()<=j.DEBUG&&N("QueryEngine","Re-using previous result from %s to execute query: %s",s.toString(),Xt(t)),this.vs(e,a,t,bg(s,Zn)).next(u=>u))})}Ds(e,t){let r=new oe(Gl(e));return t.forEach((s,o)=>{bs(e,o)&&(r=r.add(o))}),r}Cs(e,t,r,s){if(e.limit===null)return!1;if(r.size!==t.size)return!0;const o=e.limitType==="F"?t.last():t.first();return!!o&&(o.hasPendingWrites||o.version.compareTo(s)>0)}Ss(e,t,r){return Jt()<=j.DEBUG&&N("QueryEngine","Using full collection scan to execute query:",Xt(t)),this.ps.getDocumentsMatchingQuery(e,t,Tt.min(),r)}vs(e,t,r,s){return this.ps.getDocumentsMatchingQuery(e,r,s).next(o=>(t.forEach(a=>{o=o.insert(a.key,a)}),o))}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const bo="LocalStore",uy=3e8;class ly{constructor(e,t,r,s){this.persistence=e,this.Fs=t,this.serializer=s,this.Ms=new Z(q),this.xs=new zt(o=>Eo(o),To),this.Os=new Map,this.Ns=e.getRemoteDocumentCache(),this.Pi=e.getTargetCache(),this.Ii=e.getBundleCache(),this.Bs(r)}Bs(e){this.documentOverlayCache=this.persistence.getDocumentOverlayCache(e),this.indexManager=this.persistence.getIndexManager(e),this.mutationQueue=this.persistence.getMutationQueue(e,this.indexManager),this.localDocuments=new Y_(this.Ns,this.mutationQueue,this.documentOverlayCache,this.indexManager),this.Ns.setIndexManager(this.indexManager),this.Fs.initialize(this.localDocuments,this.indexManager)}collectGarbage(e){return this.persistence.runTransaction("Collect garbage","readwrite-primary",t=>e.collect(t,this.Ms))}}function hy(n,e,t,r){return new ly(n,e,t,r)}async function mh(n,e){const t=U(n);return await t.persistence.runTransaction("Handle user change","readonly",r=>{let s;return t.mutationQueue.getAllMutationBatches(r).next(o=>(s=o,t.Bs(e),t.mutationQueue.getAllMutationBatches(r))).next(o=>{const a=[],u=[];let h=$();for(const d of s){a.push(d.batchId);for(const p of d.mutations)h=h.add(p.key)}for(const d of o){u.push(d.batchId);for(const p of d.mutations)h=h.add(p.key)}return t.localDocuments.getDocuments(r,h).next(d=>({Ls:d,removedBatchIds:a,addedBatchIds:u}))})})}function dy(n,e){const t=U(n);return t.persistence.runTransaction("Acknowledge batch","readwrite-primary",r=>{const s=e.batch.keys(),o=t.Ns.newChangeBuffer({trackRemovals:!0});return function(u,h,d,p){const y=d.batch,E=y.keys();let C=P.resolve();return E.forEach(b=>{C=C.next(()=>p.getEntry(h,b)).next(O=>{const k=d.docVersions.get(b);K(k!==null,48541),O.version.compareTo(k)<0&&(y.applyToRemoteDocument(O,d),O.isValidDocument()&&(O.setReadTime(d.commitVersion),p.addEntry(O)))})}),C.next(()=>u.mutationQueue.removeMutationBatch(h,y))}(t,r,e,o).next(()=>o.apply(r)).next(()=>t.mutationQueue.performConsistencyCheck(r)).next(()=>t.documentOverlayCache.removeOverlaysForBatchId(r,s,e.batch.batchId)).next(()=>t.localDocuments.recalculateAndSaveOverlaysForDocumentKeys(r,function(u){let h=$();for(let d=0;d<u.mutationResults.length;++d)u.mutationResults[d].transformResults.length>0&&(h=h.add(u.batch.mutations[d].key));return h}(e))).next(()=>t.localDocuments.getDocuments(r,s))})}function gh(n){const e=U(n);return e.persistence.runTransaction("Get last remote snapshot version","readonly",t=>e.Pi.getLastRemoteSnapshotVersion(t))}function fy(n,e){const t=U(n),r=e.snapshotVersion;let s=t.Ms;return t.persistence.runTransaction("Apply remote event","readwrite-primary",o=>{const a=t.Ns.newChangeBuffer({trackRemovals:!0});s=t.Ms;const u=[];e.targetChanges.forEach((p,y)=>{const E=s.get(y);if(!E)return;u.push(t.Pi.removeMatchingKeys(o,p.removedDocuments,y).next(()=>t.Pi.addMatchingKeys(o,p.addedDocuments,y)));let C=E.withSequenceNumber(o.currentSequenceNumber);e.targetMismatches.get(y)!==null?C=C.withResumeToken(fe.EMPTY_BYTE_STRING,F.min()).withLastLimboFreeSnapshotVersion(F.min()):p.resumeToken.approximateByteSize()>0&&(C=C.withResumeToken(p.resumeToken,r)),s=s.insert(y,C),function(O,k,z){return O.resumeToken.approximateByteSize()===0||k.snapshotVersion.toMicroseconds()-O.snapshotVersion.toMicroseconds()>=uy?!0:z.addedDocuments.size+z.modifiedDocuments.size+z.removedDocuments.size>0}(E,C,p)&&u.push(t.Pi.updateTargetData(o,C))});let h=rt(),d=$();if(e.documentUpdates.forEach(p=>{e.resolvedLimboDocuments.has(p)&&u.push(t.persistence.referenceDelegate.updateLimboDocument(o,p))}),u.push(py(o,a,e.documentUpdates).next(p=>{h=p.ks,d=p.qs})),!r.isEqual(F.min())){const p=t.Pi.getLastRemoteSnapshotVersion(o).next(y=>t.Pi.setTargetsMetadata(o,o.currentSequenceNumber,r));u.push(p)}return P.waitFor(u).next(()=>a.apply(o)).next(()=>t.localDocuments.getLocalViewOfDocuments(o,h,d)).next(()=>h)}).then(o=>(t.Ms=s,o))}function py(n,e,t){let r=$(),s=$();return t.forEach(o=>r=r.add(o)),e.getEntries(n,r).next(o=>{let a=rt();return t.forEach((u,h)=>{const d=o.get(u);h.isFoundDocument()!==d.isFoundDocument()&&(s=s.add(u)),h.isNoDocument()&&h.version.isEqual(F.min())?(e.removeEntry(u,h.readTime),a=a.insert(u,h)):!d.isValidDocument()||h.version.compareTo(d.version)>0||h.version.compareTo(d.version)===0&&d.hasPendingWrites?(e.addEntry(h),a=a.insert(u,h)):N(bo,"Ignoring outdated watch update for ",u,". Current version:",d.version," Watch version:",h.version)}),{ks:a,qs:s}})}function my(n,e){const t=U(n);return t.persistence.runTransaction("Get next mutation batch","readonly",r=>(e===void 0&&(e=go),t.mutationQueue.getNextMutationBatchAfterBatchId(r,e)))}function gy(n,e){const t=U(n);return t.persistence.runTransaction("Allocate target","readwrite",r=>{let s;return t.Pi.getTargetData(r,e).next(o=>o?(s=o,P.resolve(s)):t.Pi.allocateTargetId(r).next(a=>(s=new pt(e,a,"TargetPurposeListen",r.currentSequenceNumber),t.Pi.addTargetData(r,s).next(()=>s))))}).then(r=>{const s=t.Ms.get(r.targetId);return(s===null||r.snapshotVersion.compareTo(s.snapshotVersion)>0)&&(t.Ms=t.Ms.insert(r.targetId,r),t.xs.set(e,r.targetId)),r})}async function Ki(n,e,t){const r=U(n),s=r.Ms.get(e),o=t?"readwrite":"readwrite-primary";try{t||await r.persistence.runTransaction("Release target",o,a=>r.persistence.referenceDelegate.removeTarget(a,s))}catch(a){if(!En(a))throw a;N(bo,`Failed to update sequence numbers for target ${e}: ${a}`)}r.Ms=r.Ms.remove(e),r.xs.delete(s.target)}function iu(n,e,t){const r=U(n);let s=F.min(),o=$();return r.persistence.runTransaction("Execute query","readwrite",a=>function(h,d,p){const y=U(h),E=y.xs.get(p);return E!==void 0?P.resolve(y.Ms.get(E)):y.Pi.getTargetData(d,p)}(r,a,Be(e)).next(u=>{if(u)return s=u.lastLimboFreeSnapshotVersion,r.Pi.getMatchingKeysForTargetId(a,u.targetId).next(h=>{o=h})}).next(()=>r.Fs.getDocumentsMatchingQuery(a,e,t?s:F.min(),t?o:$())).next(u=>(_y(r,t_(e),u),{documents:u,Qs:o})))}function _y(n,e,t){let r=n.Os.get(e)||F.min();t.forEach((s,o)=>{o.readTime.compareTo(r)>0&&(r=o.readTime)}),n.Os.set(e,r)}class ou{constructor(){this.activeTargetIds=a_()}zs(e){this.activeTargetIds=this.activeTargetIds.add(e)}js(e){this.activeTargetIds=this.activeTargetIds.delete(e)}Gs(){const e={activeTargetIds:this.activeTargetIds.toArray(),updateTimeMs:Date.now()};return JSON.stringify(e)}}class yy{constructor(){this.Mo=new ou,this.xo={},this.onlineStateHandler=null,this.sequenceNumberHandler=null}addPendingMutation(e){}updateMutationState(e,t,r){}addLocalQueryTarget(e,t=!0){return t&&this.Mo.zs(e),this.xo[e]||"not-current"}updateQueryState(e,t,r){this.xo[e]=t}removeLocalQueryTarget(e){this.Mo.js(e)}isLocalQueryTarget(e){return this.Mo.activeTargetIds.has(e)}clearQueryState(e){delete this.xo[e]}getAllActiveQueryTargets(){return this.Mo.activeTargetIds}isActiveQueryTarget(e){return this.Mo.activeTargetIds.has(e)}start(){return this.Mo=new ou,Promise.resolve()}handleUserChange(e,t,r){}setOnlineState(e){}shutdown(){}writeSequenceNumber(e){}notifyBundleLoaded(e){}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Ey{Oo(e){}shutdown(){}}/**
 * @license
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const au="ConnectivityMonitor";class cu{constructor(){this.No=()=>this.Bo(),this.Lo=()=>this.ko(),this.qo=[],this.Qo()}Oo(e){this.qo.push(e)}shutdown(){window.removeEventListener("online",this.No),window.removeEventListener("offline",this.Lo)}Qo(){window.addEventListener("online",this.No),window.addEventListener("offline",this.Lo)}Bo(){N(au,"Network connectivity changed: AVAILABLE");for(const e of this.qo)e(0)}ko(){N(au,"Network connectivity changed: UNAVAILABLE");for(const e of this.qo)e(1)}static v(){return typeof window<"u"&&window.addEventListener!==void 0&&window.removeEventListener!==void 0}}/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */let qr=null;function Qi(){return qr===null?qr=function(){return 268435456+Math.round(2147483648*Math.random())}():qr++,"0x"+qr.toString(16)}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Ai="RestConnection",Ty={BatchGetDocuments:"batchGet",Commit:"commit",RunQuery:"runQuery",RunAggregationQuery:"runAggregationQuery"};class Iy{get $o(){return!1}constructor(e){this.databaseInfo=e,this.databaseId=e.databaseId;const t=e.ssl?"https":"http",r=encodeURIComponent(this.databaseId.projectId),s=encodeURIComponent(this.databaseId.database);this.Uo=t+"://"+e.host,this.Ko=`projects/${r}/databases/${s}`,this.Wo=this.databaseId.database===us?`project_id=${r}`:`project_id=${r}&database_id=${s}`}Go(e,t,r,s,o){const a=Qi(),u=this.zo(e,t.toUriEncodedString());N(Ai,`Sending RPC '${e}' ${a}:`,u,r);const h={"google-cloud-resource-prefix":this.Ko,"x-goog-request-params":this.Wo};this.jo(h,s,o);const{host:d}=new URL(u),p=fn(d);return this.Jo(e,u,h,r,p).then(y=>(N(Ai,`Received RPC '${e}' ${a}: `,y),y),y=>{throw an(Ai,`RPC '${e}' ${a} failed with error: `,y,"url: ",u,"request:",r),y})}Ho(e,t,r,s,o,a){return this.Go(e,t,r,s,o)}jo(e,t,r){e["X-Goog-Api-Client"]=function(){return"gl-js/ fire/"+_n}(),e["Content-Type"]="text/plain",this.databaseInfo.appId&&(e["X-Firebase-GMPID"]=this.databaseInfo.appId),t&&t.headers.forEach((s,o)=>e[o]=s),r&&r.headers.forEach((s,o)=>e[o]=s)}zo(e,t){const r=Ty[e];return`${this.Uo}/v1/${t}:${r}`}terminate(){}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class vy{constructor(e){this.Yo=e.Yo,this.Zo=e.Zo}Xo(e){this.e_=e}t_(e){this.n_=e}r_(e){this.i_=e}onMessage(e){this.s_=e}close(){this.Zo()}send(e){this.Yo(e)}o_(){this.e_()}__(){this.n_()}a_(e){this.i_(e)}u_(e){this.s_(e)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Ee="WebChannelConnection";class wy extends Iy{constructor(e){super(e),this.c_=[],this.forceLongPolling=e.forceLongPolling,this.autoDetectLongPolling=e.autoDetectLongPolling,this.useFetchStreams=e.useFetchStreams,this.longPollingOptions=e.longPollingOptions}Jo(e,t,r,s,o){const a=Qi();return new Promise((u,h)=>{const d=new El;d.setWithCredentials(!0),d.listenOnce(Tl.COMPLETE,()=>{try{switch(d.getLastErrorCode()){case Qr.NO_ERROR:const y=d.getResponseJson();N(Ee,`XHR for RPC '${e}' ${a} received:`,JSON.stringify(y)),u(y);break;case Qr.TIMEOUT:N(Ee,`RPC '${e}' ${a} timed out`),h(new D(S.DEADLINE_EXCEEDED,"Request time out"));break;case Qr.HTTP_ERROR:const E=d.getStatus();if(N(Ee,`RPC '${e}' ${a} failed with status:`,E,"response text:",d.getResponseText()),E>0){let C=d.getResponseJson();Array.isArray(C)&&(C=C[0]);const b=C?.error;if(b&&b.status&&b.message){const O=function(z){const B=z.toLowerCase().replace(/_/g,"-");return Object.values(S).indexOf(B)>=0?B:S.UNKNOWN}(b.status);h(new D(O,b.message))}else h(new D(S.UNKNOWN,"Server responded with status "+d.getStatus()))}else h(new D(S.UNAVAILABLE,"Connection failed."));break;default:x(9055,{l_:e,streamId:a,h_:d.getLastErrorCode(),P_:d.getLastError()})}}finally{N(Ee,`RPC '${e}' ${a} completed.`)}});const p=JSON.stringify(s);N(Ee,`RPC '${e}' ${a} sending request:`,s),d.send(t,"POST",p,r,15)})}T_(e,t,r){const s=Qi(),o=[this.Uo,"/","google.firestore.v1.Firestore","/",e,"/channel"],a=wl(),u=vl(),h={httpSessionIdParam:"gsessionid",initMessageHeaders:{},messageUrlParams:{database:`projects/${this.databaseId.projectId}/databases/${this.databaseId.database}`},sendRawJson:!0,supportsCrossDomainXhr:!0,internalChannelParams:{forwardChannelRequestTimeoutMs:6e5},forceLongPolling:this.forceLongPolling,detectBufferingProxy:this.autoDetectLongPolling},d=this.longPollingOptions.timeoutSeconds;d!==void 0&&(h.longPollingTimeout=Math.round(1e3*d)),this.useFetchStreams&&(h.useFetchStreams=!0),this.jo(h.initMessageHeaders,t,r),h.encodeInitMessageHeaders=!0;const p=o.join("");N(Ee,`Creating RPC '${e}' stream ${s}: ${p}`,h);const y=a.createWebChannel(p,h);this.I_(y);let E=!1,C=!1;const b=new vy({Yo:k=>{C?N(Ee,`Not sending because RPC '${e}' stream ${s} is closed:`,k):(E||(N(Ee,`Opening RPC '${e}' stream ${s} transport.`),y.open(),E=!0),N(Ee,`RPC '${e}' stream ${s} sending:`,k),y.send(k))},Zo:()=>y.close()}),O=(k,z,B)=>{k.listen(z,H=>{try{B(H)}catch(ue){setTimeout(()=>{throw ue},0)}})};return O(y,Un.EventType.OPEN,()=>{C||(N(Ee,`RPC '${e}' stream ${s} transport opened.`),b.o_())}),O(y,Un.EventType.CLOSE,()=>{C||(C=!0,N(Ee,`RPC '${e}' stream ${s} transport closed`),b.a_(),this.E_(y))}),O(y,Un.EventType.ERROR,k=>{C||(C=!0,an(Ee,`RPC '${e}' stream ${s} transport errored. Name:`,k.name,"Message:",k.message),b.a_(new D(S.UNAVAILABLE,"The operation could not be completed")))}),O(y,Un.EventType.MESSAGE,k=>{if(!C){const z=k.data[0];K(!!z,16349);const B=z,H=B?.error||B[0]?.error;if(H){N(Ee,`RPC '${e}' stream ${s} received error:`,H);const ue=H.status;let xe=function(m){const _=re[m];if(_!==void 0)return rh(_)}(ue),pe=H.message;xe===void 0&&(xe=S.INTERNAL,pe="Unknown error status: "+ue+" with message "+H.message),C=!0,b.a_(new D(xe,pe)),y.close()}else N(Ee,`RPC '${e}' stream ${s} received:`,z),b.u_(z)}}),O(u,Il.STAT_EVENT,k=>{k.stat===Li.PROXY?N(Ee,`RPC '${e}' stream ${s} detected buffering proxy`):k.stat===Li.NOPROXY&&N(Ee,`RPC '${e}' stream ${s} detected no buffering proxy`)}),setTimeout(()=>{b.__()},0),b}terminate(){this.c_.forEach(e=>e.close()),this.c_=[]}I_(e){this.c_.push(e)}E_(e){this.c_=this.c_.filter(t=>t===e)}}function Ri(){return typeof document<"u"?document:null}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Ns(n){return new P_(n,!0)}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class _h{constructor(e,t,r=1e3,s=1.5,o=6e4){this.Mi=e,this.timerId=t,this.d_=r,this.A_=s,this.R_=o,this.V_=0,this.m_=null,this.f_=Date.now(),this.reset()}reset(){this.V_=0}g_(){this.V_=this.R_}p_(e){this.cancel();const t=Math.floor(this.V_+this.y_()),r=Math.max(0,Date.now()-this.f_),s=Math.max(0,t-r);s>0&&N("ExponentialBackoff",`Backing off for ${s} ms (base delay: ${this.V_} ms, delay with jitter: ${t} ms, last attempt: ${r} ms ago)`),this.m_=this.Mi.enqueueAfterDelay(this.timerId,s,()=>(this.f_=Date.now(),e())),this.V_*=this.A_,this.V_<this.d_&&(this.V_=this.d_),this.V_>this.R_&&(this.V_=this.R_)}w_(){this.m_!==null&&(this.m_.skipDelay(),this.m_=null)}cancel(){this.m_!==null&&(this.m_.cancel(),this.m_=null)}y_(){return(Math.random()-.5)*this.V_}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const uu="PersistentStream";class yh{constructor(e,t,r,s,o,a,u,h){this.Mi=e,this.S_=r,this.b_=s,this.connection=o,this.authCredentialsProvider=a,this.appCheckCredentialsProvider=u,this.listener=h,this.state=0,this.D_=0,this.C_=null,this.v_=null,this.stream=null,this.F_=0,this.M_=new _h(e,t)}x_(){return this.state===1||this.state===5||this.O_()}O_(){return this.state===2||this.state===3}start(){this.F_=0,this.state!==4?this.auth():this.N_()}async stop(){this.x_()&&await this.close(0)}B_(){this.state=0,this.M_.reset()}L_(){this.O_()&&this.C_===null&&(this.C_=this.Mi.enqueueAfterDelay(this.S_,6e4,()=>this.k_()))}q_(e){this.Q_(),this.stream.send(e)}async k_(){if(this.O_())return this.close(0)}Q_(){this.C_&&(this.C_.cancel(),this.C_=null)}U_(){this.v_&&(this.v_.cancel(),this.v_=null)}async close(e,t){this.Q_(),this.U_(),this.M_.cancel(),this.D_++,e!==4?this.M_.reset():t&&t.code===S.RESOURCE_EXHAUSTED?(nt(t.toString()),nt("Using maximum backoff delay to prevent overloading the backend."),this.M_.g_()):t&&t.code===S.UNAUTHENTICATED&&this.state!==3&&(this.authCredentialsProvider.invalidateToken(),this.appCheckCredentialsProvider.invalidateToken()),this.stream!==null&&(this.K_(),this.stream.close(),this.stream=null),this.state=e,await this.listener.r_(t)}K_(){}auth(){this.state=1;const e=this.W_(this.D_),t=this.D_;Promise.all([this.authCredentialsProvider.getToken(),this.appCheckCredentialsProvider.getToken()]).then(([r,s])=>{this.D_===t&&this.G_(r,s)},r=>{e(()=>{const s=new D(S.UNKNOWN,"Fetching auth token failed: "+r.message);return this.z_(s)})})}G_(e,t){const r=this.W_(this.D_);this.stream=this.j_(e,t),this.stream.Xo(()=>{r(()=>this.listener.Xo())}),this.stream.t_(()=>{r(()=>(this.state=2,this.v_=this.Mi.enqueueAfterDelay(this.b_,1e4,()=>(this.O_()&&(this.state=3),Promise.resolve())),this.listener.t_()))}),this.stream.r_(s=>{r(()=>this.z_(s))}),this.stream.onMessage(s=>{r(()=>++this.F_==1?this.J_(s):this.onNext(s))})}N_(){this.state=5,this.M_.p_(async()=>{this.state=0,this.start()})}z_(e){return N(uu,`close with error: ${e}`),this.stream=null,this.close(4,e)}W_(e){return t=>{this.Mi.enqueueAndForget(()=>this.D_===e?t():(N(uu,"stream callback skipped by getCloseGuardedDispatcher."),Promise.resolve()))}}}class Ay extends yh{constructor(e,t,r,s,o,a){super(e,"listen_stream_connection_backoff","listen_stream_idle","health_check_timeout",t,r,s,a),this.serializer=o}j_(e,t){return this.connection.T_("Listen",e,t)}J_(e){return this.onNext(e)}onNext(e){this.M_.reset();const t=V_(this.serializer,e),r=function(o){if(!("targetChange"in o))return F.min();const a=o.targetChange;return a.targetIds&&a.targetIds.length?F.min():a.readTime?je(a.readTime):F.min()}(e);return this.listener.H_(t,r)}Y_(e){const t={};t.database=Wi(this.serializer),t.addTarget=function(o,a){let u;const h=a.target;if(u=ji(h)?{documents:N_(o,h)}:{query:O_(o,h).ft},u.targetId=a.targetId,a.resumeToken.approximateByteSize()>0){u.resumeToken=oh(o,a.resumeToken);const d=zi(o,a.expectedCount);d!==null&&(u.expectedCount=d)}else if(a.snapshotVersion.compareTo(F.min())>0){u.readTime=fs(o,a.snapshotVersion.toTimestamp());const d=zi(o,a.expectedCount);d!==null&&(u.expectedCount=d)}return u}(this.serializer,e);const r=L_(this.serializer,e);r&&(t.labels=r),this.q_(t)}Z_(e){const t={};t.database=Wi(this.serializer),t.removeTarget=e,this.q_(t)}}class Ry extends yh{constructor(e,t,r,s,o,a){super(e,"write_stream_connection_backoff","write_stream_idle","health_check_timeout",t,r,s,a),this.serializer=o}get X_(){return this.F_>0}start(){this.lastStreamToken=void 0,super.start()}K_(){this.X_&&this.ea([])}j_(e,t){return this.connection.T_("Write",e,t)}J_(e){return K(!!e.streamToken,31322),this.lastStreamToken=e.streamToken,K(!e.writeResults||e.writeResults.length===0,55816),this.listener.ta()}onNext(e){K(!!e.streamToken,12678),this.lastStreamToken=e.streamToken,this.M_.reset();const t=D_(e.writeResults,e.commitTime),r=je(e.commitTime);return this.listener.na(r,t)}ra(){const e={};e.database=Wi(this.serializer),this.q_(e)}ea(e){const t={streamToken:this.lastStreamToken,writes:e.map(r=>k_(this.serializer,r))};this.q_(t)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Sy{}class Py extends Sy{constructor(e,t,r,s){super(),this.authCredentials=e,this.appCheckCredentials=t,this.connection=r,this.serializer=s,this.ia=!1}sa(){if(this.ia)throw new D(S.FAILED_PRECONDITION,"The client has already been terminated.")}Go(e,t,r,s){return this.sa(),Promise.all([this.authCredentials.getToken(),this.appCheckCredentials.getToken()]).then(([o,a])=>this.connection.Go(e,Hi(t,r),s,o,a)).catch(o=>{throw o.name==="FirebaseError"?(o.code===S.UNAUTHENTICATED&&(this.authCredentials.invalidateToken(),this.appCheckCredentials.invalidateToken()),o):new D(S.UNKNOWN,o.toString())})}Ho(e,t,r,s,o){return this.sa(),Promise.all([this.authCredentials.getToken(),this.appCheckCredentials.getToken()]).then(([a,u])=>this.connection.Ho(e,Hi(t,r),s,a,u,o)).catch(a=>{throw a.name==="FirebaseError"?(a.code===S.UNAUTHENTICATED&&(this.authCredentials.invalidateToken(),this.appCheckCredentials.invalidateToken()),a):new D(S.UNKNOWN,a.toString())})}terminate(){this.ia=!0,this.connection.terminate()}}class Cy{constructor(e,t){this.asyncQueue=e,this.onlineStateHandler=t,this.state="Unknown",this.oa=0,this._a=null,this.aa=!0}ua(){this.oa===0&&(this.ca("Unknown"),this._a=this.asyncQueue.enqueueAfterDelay("online_state_timeout",1e4,()=>(this._a=null,this.la("Backend didn't respond within 10 seconds."),this.ca("Offline"),Promise.resolve())))}ha(e){this.state==="Online"?this.ca("Unknown"):(this.oa++,this.oa>=1&&(this.Pa(),this.la(`Connection failed 1 times. Most recent error: ${e.toString()}`),this.ca("Offline")))}set(e){this.Pa(),this.oa=0,e==="Online"&&(this.aa=!1),this.ca(e)}ca(e){e!==this.state&&(this.state=e,this.onlineStateHandler(e))}la(e){const t=`Could not reach Cloud Firestore backend. ${e}
This typically indicates that your device does not have a healthy Internet connection at the moment. The client will operate in offline mode until it is able to successfully connect to the backend.`;this.aa?(nt(t),this.aa=!1):N("OnlineStateTracker",t)}Pa(){this._a!==null&&(this._a.cancel(),this._a=null)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const $t="RemoteStore";class by{constructor(e,t,r,s,o){this.localStore=e,this.datastore=t,this.asyncQueue=r,this.remoteSyncer={},this.Ta=[],this.Ia=new Map,this.Ea=new Set,this.da=[],this.Aa=o,this.Aa.Oo(a=>{r.enqueueAndForget(async()=>{Ht(this)&&(N($t,"Restarting streams for network reachability change."),await async function(h){const d=U(h);d.Ea.add(4),await pr(d),d.Ra.set("Unknown"),d.Ea.delete(4),await Os(d)}(this))})}),this.Ra=new Cy(r,s)}}async function Os(n){if(Ht(n))for(const e of n.da)await e(!0)}async function pr(n){for(const e of n.da)await e(!1)}function Eh(n,e){const t=U(n);t.Ia.has(e.targetId)||(t.Ia.set(e.targetId,e),No(t)?Do(t):In(t).O_()&&ko(t,e))}function Vo(n,e){const t=U(n),r=In(t);t.Ia.delete(e),r.O_()&&Th(t,e),t.Ia.size===0&&(r.O_()?r.L_():Ht(t)&&t.Ra.set("Unknown"))}function ko(n,e){if(n.Va.Ue(e.targetId),e.resumeToken.approximateByteSize()>0||e.snapshotVersion.compareTo(F.min())>0){const t=n.remoteSyncer.getRemoteKeysForTarget(e.targetId).size;e=e.withExpectedCount(t)}In(n).Y_(e)}function Th(n,e){n.Va.Ue(e),In(n).Z_(e)}function Do(n){n.Va=new w_({getRemoteKeysForTarget:e=>n.remoteSyncer.getRemoteKeysForTarget(e),At:e=>n.Ia.get(e)||null,ht:()=>n.datastore.serializer.databaseId}),In(n).start(),n.Ra.ua()}function No(n){return Ht(n)&&!In(n).x_()&&n.Ia.size>0}function Ht(n){return U(n).Ea.size===0}function Ih(n){n.Va=void 0}async function Vy(n){n.Ra.set("Online")}async function ky(n){n.Ia.forEach((e,t)=>{ko(n,e)})}async function Dy(n,e){Ih(n),No(n)?(n.Ra.ha(e),Do(n)):n.Ra.set("Unknown")}async function Ny(n,e,t){if(n.Ra.set("Online"),e instanceof ih&&e.state===2&&e.cause)try{await async function(s,o){const a=o.cause;for(const u of o.targetIds)s.Ia.has(u)&&(await s.remoteSyncer.rejectListen(u,a),s.Ia.delete(u),s.Va.removeTarget(u))}(n,e)}catch(r){N($t,"Failed to remove targets %s: %s ",e.targetIds.join(","),r),await ms(n,r)}else if(e instanceof Zr?n.Va.Ze(e):e instanceof sh?n.Va.st(e):n.Va.tt(e),!t.isEqual(F.min()))try{const r=await gh(n.localStore);t.compareTo(r)>=0&&await function(o,a){const u=o.Va.Tt(a);return u.targetChanges.forEach((h,d)=>{if(h.resumeToken.approximateByteSize()>0){const p=o.Ia.get(d);p&&o.Ia.set(d,p.withResumeToken(h.resumeToken,a))}}),u.targetMismatches.forEach((h,d)=>{const p=o.Ia.get(h);if(!p)return;o.Ia.set(h,p.withResumeToken(fe.EMPTY_BYTE_STRING,p.snapshotVersion)),Th(o,h);const y=new pt(p.target,h,d,p.sequenceNumber);ko(o,y)}),o.remoteSyncer.applyRemoteEvent(u)}(n,t)}catch(r){N($t,"Failed to raise snapshot:",r),await ms(n,r)}}async function ms(n,e,t){if(!En(e))throw e;n.Ea.add(1),await pr(n),n.Ra.set("Offline"),t||(t=()=>gh(n.localStore)),n.asyncQueue.enqueueRetryable(async()=>{N($t,"Retrying IndexedDB access"),await t(),n.Ea.delete(1),await Os(n)})}function vh(n,e){return e().catch(t=>ms(n,t,e))}async function Ms(n){const e=U(n),t=At(e);let r=e.Ta.length>0?e.Ta[e.Ta.length-1].batchId:go;for(;Oy(e);)try{const s=await my(e.localStore,r);if(s===null){e.Ta.length===0&&t.L_();break}r=s.batchId,My(e,s)}catch(s){await ms(e,s)}wh(e)&&Ah(e)}function Oy(n){return Ht(n)&&n.Ta.length<10}function My(n,e){n.Ta.push(e);const t=At(n);t.O_()&&t.X_&&t.ea(e.mutations)}function wh(n){return Ht(n)&&!At(n).x_()&&n.Ta.length>0}function Ah(n){At(n).start()}async function Ly(n){At(n).ra()}async function xy(n){const e=At(n);for(const t of n.Ta)e.ea(t.mutations)}async function Fy(n,e,t){const r=n.Ta.shift(),s=wo.from(r,e,t);await vh(n,()=>n.remoteSyncer.applySuccessfulWrite(s)),await Ms(n)}async function Uy(n,e){e&&At(n).X_&&await async function(r,s){if(function(a){return T_(a)&&a!==S.ABORTED}(s.code)){const o=r.Ta.shift();At(r).B_(),await vh(r,()=>r.remoteSyncer.rejectFailedWrite(o.batchId,s)),await Ms(r)}}(n,e),wh(n)&&Ah(n)}async function lu(n,e){const t=U(n);t.asyncQueue.verifyOperationInProgress(),N($t,"RemoteStore received new credentials");const r=Ht(t);t.Ea.add(3),await pr(t),r&&t.Ra.set("Unknown"),await t.remoteSyncer.handleCredentialChange(e),t.Ea.delete(3),await Os(t)}async function By(n,e){const t=U(n);e?(t.Ea.delete(2),await Os(t)):e||(t.Ea.add(2),await pr(t),t.Ra.set("Unknown"))}function In(n){return n.ma||(n.ma=function(t,r,s){const o=U(t);return o.sa(),new Ay(r,o.connection,o.authCredentials,o.appCheckCredentials,o.serializer,s)}(n.datastore,n.asyncQueue,{Xo:Vy.bind(null,n),t_:ky.bind(null,n),r_:Dy.bind(null,n),H_:Ny.bind(null,n)}),n.da.push(async e=>{e?(n.ma.B_(),No(n)?Do(n):n.Ra.set("Unknown")):(await n.ma.stop(),Ih(n))})),n.ma}function At(n){return n.fa||(n.fa=function(t,r,s){const o=U(t);return o.sa(),new Ry(r,o.connection,o.authCredentials,o.appCheckCredentials,o.serializer,s)}(n.datastore,n.asyncQueue,{Xo:()=>Promise.resolve(),t_:Ly.bind(null,n),r_:Uy.bind(null,n),ta:xy.bind(null,n),na:Fy.bind(null,n)}),n.da.push(async e=>{e?(n.fa.B_(),await Ms(n)):(await n.fa.stop(),n.Ta.length>0&&(N($t,`Stopping write stream with ${n.Ta.length} pending writes`),n.Ta=[]))})),n.fa}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Oo{constructor(e,t,r,s,o){this.asyncQueue=e,this.timerId=t,this.targetTimeMs=r,this.op=s,this.removalCallback=o,this.deferred=new Ye,this.then=this.deferred.promise.then.bind(this.deferred.promise),this.deferred.promise.catch(a=>{})}get promise(){return this.deferred.promise}static createAndSchedule(e,t,r,s,o){const a=Date.now()+r,u=new Oo(e,t,a,s,o);return u.start(r),u}start(e){this.timerHandle=setTimeout(()=>this.handleDelayElapsed(),e)}skipDelay(){return this.handleDelayElapsed()}cancel(e){this.timerHandle!==null&&(this.clearTimeout(),this.deferred.reject(new D(S.CANCELLED,"Operation cancelled"+(e?": "+e:""))))}handleDelayElapsed(){this.asyncQueue.enqueueAndForget(()=>this.timerHandle!==null?(this.clearTimeout(),this.op().then(e=>this.deferred.resolve(e))):Promise.resolve())}clearTimeout(){this.timerHandle!==null&&(this.removalCallback(this),clearTimeout(this.timerHandle),this.timerHandle=null)}}function Mo(n,e){if(nt("AsyncQueue",`${e}: ${n}`),En(n))return new D(S.UNAVAILABLE,`${e}: ${n}`);throw n}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class rn{static emptySet(e){return new rn(e.comparator)}constructor(e){this.comparator=e?(t,r)=>e(t,r)||M.comparator(t.key,r.key):(t,r)=>M.comparator(t.key,r.key),this.keyedMap=Bn(),this.sortedSet=new Z(this.comparator)}has(e){return this.keyedMap.get(e)!=null}get(e){return this.keyedMap.get(e)}first(){return this.sortedSet.minKey()}last(){return this.sortedSet.maxKey()}isEmpty(){return this.sortedSet.isEmpty()}indexOf(e){const t=this.keyedMap.get(e);return t?this.sortedSet.indexOf(t):-1}get size(){return this.sortedSet.size}forEach(e){this.sortedSet.inorderTraversal((t,r)=>(e(t),!1))}add(e){const t=this.delete(e.key);return t.copy(t.keyedMap.insert(e.key,e),t.sortedSet.insert(e,null))}delete(e){const t=this.get(e);return t?this.copy(this.keyedMap.remove(e),this.sortedSet.remove(t)):this}isEqual(e){if(!(e instanceof rn)||this.size!==e.size)return!1;const t=this.sortedSet.getIterator(),r=e.sortedSet.getIterator();for(;t.hasNext();){const s=t.getNext().key,o=r.getNext().key;if(!s.isEqual(o))return!1}return!0}toString(){const e=[];return this.forEach(t=>{e.push(t.toString())}),e.length===0?"DocumentSet ()":`DocumentSet (
  `+e.join(`  
`)+`
)`}copy(e,t){const r=new rn;return r.comparator=this.comparator,r.keyedMap=e,r.sortedSet=t,r}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class hu{constructor(){this.ga=new Z(M.comparator)}track(e){const t=e.doc.key,r=this.ga.get(t);r?e.type!==0&&r.type===3?this.ga=this.ga.insert(t,e):e.type===3&&r.type!==1?this.ga=this.ga.insert(t,{type:r.type,doc:e.doc}):e.type===2&&r.type===2?this.ga=this.ga.insert(t,{type:2,doc:e.doc}):e.type===2&&r.type===0?this.ga=this.ga.insert(t,{type:0,doc:e.doc}):e.type===1&&r.type===0?this.ga=this.ga.remove(t):e.type===1&&r.type===2?this.ga=this.ga.insert(t,{type:1,doc:r.doc}):e.type===0&&r.type===1?this.ga=this.ga.insert(t,{type:2,doc:e.doc}):x(63341,{Rt:e,pa:r}):this.ga=this.ga.insert(t,e)}ya(){const e=[];return this.ga.inorderTraversal((t,r)=>{e.push(r)}),e}}class dn{constructor(e,t,r,s,o,a,u,h,d){this.query=e,this.docs=t,this.oldDocs=r,this.docChanges=s,this.mutatedKeys=o,this.fromCache=a,this.syncStateChanged=u,this.excludesMetadataChanges=h,this.hasCachedResults=d}static fromInitialDocuments(e,t,r,s,o){const a=[];return t.forEach(u=>{a.push({type:0,doc:u})}),new dn(e,t,rn.emptySet(t),a,r,s,!0,!1,o)}get hasPendingWrites(){return!this.mutatedKeys.isEmpty()}isEqual(e){if(!(this.fromCache===e.fromCache&&this.hasCachedResults===e.hasCachedResults&&this.syncStateChanged===e.syncStateChanged&&this.mutatedKeys.isEqual(e.mutatedKeys)&&Cs(this.query,e.query)&&this.docs.isEqual(e.docs)&&this.oldDocs.isEqual(e.oldDocs)))return!1;const t=this.docChanges,r=e.docChanges;if(t.length!==r.length)return!1;for(let s=0;s<t.length;s++)if(t[s].type!==r[s].type||!t[s].doc.isEqual(r[s].doc))return!1;return!0}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class jy{constructor(){this.wa=void 0,this.Sa=[]}ba(){return this.Sa.some(e=>e.Da())}}class qy{constructor(){this.queries=du(),this.onlineState="Unknown",this.Ca=new Set}terminate(){(function(t,r){const s=U(t),o=s.queries;s.queries=du(),o.forEach((a,u)=>{for(const h of u.Sa)h.onError(r)})})(this,new D(S.ABORTED,"Firestore shutting down"))}}function du(){return new zt(n=>Hl(n),Cs)}async function Lo(n,e){const t=U(n);let r=3;const s=e.query;let o=t.queries.get(s);o?!o.ba()&&e.Da()&&(r=2):(o=new jy,r=e.Da()?0:1);try{switch(r){case 0:o.wa=await t.onListen(s,!0);break;case 1:o.wa=await t.onListen(s,!1);break;case 2:await t.onFirstRemoteStoreListen(s)}}catch(a){const u=Mo(a,`Initialization of query '${Xt(e.query)}' failed`);return void e.onError(u)}t.queries.set(s,o),o.Sa.push(e),e.va(t.onlineState),o.wa&&e.Fa(o.wa)&&Fo(t)}async function xo(n,e){const t=U(n),r=e.query;let s=3;const o=t.queries.get(r);if(o){const a=o.Sa.indexOf(e);a>=0&&(o.Sa.splice(a,1),o.Sa.length===0?s=e.Da()?0:1:!o.ba()&&e.Da()&&(s=2))}switch(s){case 0:return t.queries.delete(r),t.onUnlisten(r,!0);case 1:return t.queries.delete(r),t.onUnlisten(r,!1);case 2:return t.onLastRemoteStoreUnlisten(r);default:return}}function $y(n,e){const t=U(n);let r=!1;for(const s of e){const o=s.query,a=t.queries.get(o);if(a){for(const u of a.Sa)u.Fa(s)&&(r=!0);a.wa=s}}r&&Fo(t)}function zy(n,e,t){const r=U(n),s=r.queries.get(e);if(s)for(const o of s.Sa)o.onError(t);r.queries.delete(e)}function Fo(n){n.Ca.forEach(e=>{e.next()})}var Ji,fu;(fu=Ji||(Ji={})).Ma="default",fu.Cache="cache";class Uo{constructor(e,t,r){this.query=e,this.xa=t,this.Oa=!1,this.Na=null,this.onlineState="Unknown",this.options=r||{}}Fa(e){if(!this.options.includeMetadataChanges){const r=[];for(const s of e.docChanges)s.type!==3&&r.push(s);e=new dn(e.query,e.docs,e.oldDocs,r,e.mutatedKeys,e.fromCache,e.syncStateChanged,!0,e.hasCachedResults)}let t=!1;return this.Oa?this.Ba(e)&&(this.xa.next(e),t=!0):this.La(e,this.onlineState)&&(this.ka(e),t=!0),this.Na=e,t}onError(e){this.xa.error(e)}va(e){this.onlineState=e;let t=!1;return this.Na&&!this.Oa&&this.La(this.Na,e)&&(this.ka(this.Na),t=!0),t}La(e,t){if(!e.fromCache||!this.Da())return!0;const r=t!=="Offline";return(!this.options.qa||!r)&&(!e.docs.isEmpty()||e.hasCachedResults||t==="Offline")}Ba(e){if(e.docChanges.length>0)return!0;const t=this.Na&&this.Na.hasPendingWrites!==e.hasPendingWrites;return!(!e.syncStateChanged&&!t)&&this.options.includeMetadataChanges===!0}ka(e){e=dn.fromInitialDocuments(e.query,e.docs,e.mutatedKeys,e.fromCache,e.hasCachedResults),this.Oa=!0,this.xa.next(e)}Da(){return this.options.source!==Ji.Cache}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Rh{constructor(e){this.key=e}}class Sh{constructor(e){this.key=e}}class Hy{constructor(e,t){this.query=e,this.Ya=t,this.Za=null,this.hasCachedResults=!1,this.current=!1,this.Xa=$(),this.mutatedKeys=$(),this.eu=Gl(e),this.tu=new rn(this.eu)}get nu(){return this.Ya}ru(e,t){const r=t?t.iu:new hu,s=t?t.tu:this.tu;let o=t?t.mutatedKeys:this.mutatedKeys,a=s,u=!1;const h=this.query.limitType==="F"&&s.size===this.query.limit?s.last():null,d=this.query.limitType==="L"&&s.size===this.query.limit?s.first():null;if(e.inorderTraversal((p,y)=>{const E=s.get(p),C=bs(this.query,y)?y:null,b=!!E&&this.mutatedKeys.has(E.key),O=!!C&&(C.hasLocalMutations||this.mutatedKeys.has(C.key)&&C.hasCommittedMutations);let k=!1;E&&C?E.data.isEqual(C.data)?b!==O&&(r.track({type:3,doc:C}),k=!0):this.su(E,C)||(r.track({type:2,doc:C}),k=!0,(h&&this.eu(C,h)>0||d&&this.eu(C,d)<0)&&(u=!0)):!E&&C?(r.track({type:0,doc:C}),k=!0):E&&!C&&(r.track({type:1,doc:E}),k=!0,(h||d)&&(u=!0)),k&&(C?(a=a.add(C),o=O?o.add(p):o.delete(p)):(a=a.delete(p),o=o.delete(p)))}),this.query.limit!==null)for(;a.size>this.query.limit;){const p=this.query.limitType==="F"?a.last():a.first();a=a.delete(p.key),o=o.delete(p.key),r.track({type:1,doc:p})}return{tu:a,iu:r,Cs:u,mutatedKeys:o}}su(e,t){return e.hasLocalMutations&&t.hasCommittedMutations&&!t.hasLocalMutations}applyChanges(e,t,r,s){const o=this.tu;this.tu=e.tu,this.mutatedKeys=e.mutatedKeys;const a=e.iu.ya();a.sort((p,y)=>function(C,b){const O=k=>{switch(k){case 0:return 1;case 2:case 3:return 2;case 1:return 0;default:return x(20277,{Rt:k})}};return O(C)-O(b)}(p.type,y.type)||this.eu(p.doc,y.doc)),this.ou(r),s=s??!1;const u=t&&!s?this._u():[],h=this.Xa.size===0&&this.current&&!s?1:0,d=h!==this.Za;return this.Za=h,a.length!==0||d?{snapshot:new dn(this.query,e.tu,o,a,e.mutatedKeys,h===0,d,!1,!!r&&r.resumeToken.approximateByteSize()>0),au:u}:{au:u}}va(e){return this.current&&e==="Offline"?(this.current=!1,this.applyChanges({tu:this.tu,iu:new hu,mutatedKeys:this.mutatedKeys,Cs:!1},!1)):{au:[]}}uu(e){return!this.Ya.has(e)&&!!this.tu.has(e)&&!this.tu.get(e).hasLocalMutations}ou(e){e&&(e.addedDocuments.forEach(t=>this.Ya=this.Ya.add(t)),e.modifiedDocuments.forEach(t=>{}),e.removedDocuments.forEach(t=>this.Ya=this.Ya.delete(t)),this.current=e.current)}_u(){if(!this.current)return[];const e=this.Xa;this.Xa=$(),this.tu.forEach(r=>{this.uu(r.key)&&(this.Xa=this.Xa.add(r.key))});const t=[];return e.forEach(r=>{this.Xa.has(r)||t.push(new Sh(r))}),this.Xa.forEach(r=>{e.has(r)||t.push(new Rh(r))}),t}cu(e){this.Ya=e.Qs,this.Xa=$();const t=this.ru(e.documents);return this.applyChanges(t,!0)}lu(){return dn.fromInitialDocuments(this.query,this.tu,this.mutatedKeys,this.Za===0,this.hasCachedResults)}}const Bo="SyncEngine";class Gy{constructor(e,t,r){this.query=e,this.targetId=t,this.view=r}}class Wy{constructor(e){this.key=e,this.hu=!1}}class Ky{constructor(e,t,r,s,o,a){this.localStore=e,this.remoteStore=t,this.eventManager=r,this.sharedClientState=s,this.currentUser=o,this.maxConcurrentLimboResolutions=a,this.Pu={},this.Tu=new zt(u=>Hl(u),Cs),this.Iu=new Map,this.Eu=new Set,this.du=new Z(M.comparator),this.Au=new Map,this.Ru=new So,this.Vu={},this.mu=new Map,this.fu=hn.cr(),this.onlineState="Unknown",this.gu=void 0}get isPrimaryClient(){return this.gu===!0}}async function Qy(n,e,t=!0){const r=Dh(n);let s;const o=r.Tu.get(e);return o?(r.sharedClientState.addLocalQueryTarget(o.targetId),s=o.view.lu()):s=await Ph(r,e,t,!0),s}async function Jy(n,e){const t=Dh(n);await Ph(t,e,!0,!1)}async function Ph(n,e,t,r){const s=await gy(n.localStore,Be(e)),o=s.targetId,a=n.sharedClientState.addLocalQueryTarget(o,t);let u;return r&&(u=await Xy(n,e,o,a==="current",s.resumeToken)),n.isPrimaryClient&&t&&Eh(n.remoteStore,s),u}async function Xy(n,e,t,r,s){n.pu=(y,E,C)=>async function(O,k,z,B){let H=k.view.ru(z);H.Cs&&(H=await iu(O.localStore,k.query,!1).then(({documents:v})=>k.view.ru(v,H)));const ue=B&&B.targetChanges.get(k.targetId),xe=B&&B.targetMismatches.get(k.targetId)!=null,pe=k.view.applyChanges(H,O.isPrimaryClient,ue,xe);return mu(O,k.targetId,pe.au),pe.snapshot}(n,y,E,C);const o=await iu(n.localStore,e,!0),a=new Hy(e,o.Qs),u=a.ru(o.documents),h=fr.createSynthesizedTargetChangeForCurrentChange(t,r&&n.onlineState!=="Offline",s),d=a.applyChanges(u,n.isPrimaryClient,h);mu(n,t,d.au);const p=new Gy(e,t,a);return n.Tu.set(e,p),n.Iu.has(t)?n.Iu.get(t).push(e):n.Iu.set(t,[e]),d.snapshot}async function Yy(n,e,t){const r=U(n),s=r.Tu.get(e),o=r.Iu.get(s.targetId);if(o.length>1)return r.Iu.set(s.targetId,o.filter(a=>!Cs(a,e))),void r.Tu.delete(e);r.isPrimaryClient?(r.sharedClientState.removeLocalQueryTarget(s.targetId),r.sharedClientState.isActiveQueryTarget(s.targetId)||await Ki(r.localStore,s.targetId,!1).then(()=>{r.sharedClientState.clearQueryState(s.targetId),t&&Vo(r.remoteStore,s.targetId),Xi(r,s.targetId)}).catch(yn)):(Xi(r,s.targetId),await Ki(r.localStore,s.targetId,!0))}async function Zy(n,e){const t=U(n),r=t.Tu.get(e),s=t.Iu.get(r.targetId);t.isPrimaryClient&&s.length===1&&(t.sharedClientState.removeLocalQueryTarget(r.targetId),Vo(t.remoteStore,r.targetId))}async function eE(n,e,t){const r=aE(n);try{const s=await function(a,u){const h=U(a),d=Y.now(),p=u.reduce((C,b)=>C.add(b.key),$());let y,E;return h.persistence.runTransaction("Locally write mutations","readwrite",C=>{let b=rt(),O=$();return h.Ns.getEntries(C,p).next(k=>{b=k,b.forEach((z,B)=>{B.isValidDocument()||(O=O.add(z))})}).next(()=>h.localDocuments.getOverlayedDocuments(C,b)).next(k=>{y=k;const z=[];for(const B of u){const H=m_(B,y.get(B.key).overlayedDocument);H!=null&&z.push(new Pt(B.key,H,xl(H.value.mapValue),ke.exists(!0)))}return h.mutationQueue.addMutationBatch(C,d,z,u)}).next(k=>{E=k;const z=k.applyToLocalDocumentSet(y,O);return h.documentOverlayCache.saveOverlays(C,k.batchId,z)})}).then(()=>({batchId:E.batchId,changes:Kl(y)}))}(r.localStore,e);r.sharedClientState.addPendingMutation(s.batchId),function(a,u,h){let d=a.Vu[a.currentUser.toKey()];d||(d=new Z(q)),d=d.insert(u,h),a.Vu[a.currentUser.toKey()]=d}(r,s.batchId,t),await mr(r,s.changes),await Ms(r.remoteStore)}catch(s){const o=Mo(s,"Failed to persist write");t.reject(o)}}async function Ch(n,e){const t=U(n);try{const r=await fy(t.localStore,e);e.targetChanges.forEach((s,o)=>{const a=t.Au.get(o);a&&(K(s.addedDocuments.size+s.modifiedDocuments.size+s.removedDocuments.size<=1,22616),s.addedDocuments.size>0?a.hu=!0:s.modifiedDocuments.size>0?K(a.hu,14607):s.removedDocuments.size>0&&(K(a.hu,42227),a.hu=!1))}),await mr(t,r,e)}catch(r){await yn(r)}}function pu(n,e,t){const r=U(n);if(r.isPrimaryClient&&t===0||!r.isPrimaryClient&&t===1){const s=[];r.Tu.forEach((o,a)=>{const u=a.view.va(e);u.snapshot&&s.push(u.snapshot)}),function(a,u){const h=U(a);h.onlineState=u;let d=!1;h.queries.forEach((p,y)=>{for(const E of y.Sa)E.va(u)&&(d=!0)}),d&&Fo(h)}(r.eventManager,e),s.length&&r.Pu.H_(s),r.onlineState=e,r.isPrimaryClient&&r.sharedClientState.setOnlineState(e)}}async function tE(n,e,t){const r=U(n);r.sharedClientState.updateQueryState(e,"rejected",t);const s=r.Au.get(e),o=s&&s.key;if(o){let a=new Z(M.comparator);a=a.insert(o,Ie.newNoDocument(o,F.min()));const u=$().add(o),h=new Ds(F.min(),new Map,new Z(q),a,u);await Ch(r,h),r.du=r.du.remove(o),r.Au.delete(e),jo(r)}else await Ki(r.localStore,e,!1).then(()=>Xi(r,e,t)).catch(yn)}async function nE(n,e){const t=U(n),r=e.batch.batchId;try{const s=await dy(t.localStore,e);Vh(t,r,null),bh(t,r),t.sharedClientState.updateMutationState(r,"acknowledged"),await mr(t,s)}catch(s){await yn(s)}}async function rE(n,e,t){const r=U(n);try{const s=await function(a,u){const h=U(a);return h.persistence.runTransaction("Reject batch","readwrite-primary",d=>{let p;return h.mutationQueue.lookupMutationBatch(d,u).next(y=>(K(y!==null,37113),p=y.keys(),h.mutationQueue.removeMutationBatch(d,y))).next(()=>h.mutationQueue.performConsistencyCheck(d)).next(()=>h.documentOverlayCache.removeOverlaysForBatchId(d,p,u)).next(()=>h.localDocuments.recalculateAndSaveOverlaysForDocumentKeys(d,p)).next(()=>h.localDocuments.getDocuments(d,p))})}(r.localStore,e);Vh(r,e,t),bh(r,e),r.sharedClientState.updateMutationState(e,"rejected",t),await mr(r,s)}catch(s){await yn(s)}}function bh(n,e){(n.mu.get(e)||[]).forEach(t=>{t.resolve()}),n.mu.delete(e)}function Vh(n,e,t){const r=U(n);let s=r.Vu[r.currentUser.toKey()];if(s){const o=s.get(e);o&&(t?o.reject(t):o.resolve(),s=s.remove(e)),r.Vu[r.currentUser.toKey()]=s}}function Xi(n,e,t=null){n.sharedClientState.removeLocalQueryTarget(e);for(const r of n.Iu.get(e))n.Tu.delete(r),t&&n.Pu.yu(r,t);n.Iu.delete(e),n.isPrimaryClient&&n.Ru.jr(e).forEach(r=>{n.Ru.containsKey(r)||kh(n,r)})}function kh(n,e){n.Eu.delete(e.path.canonicalString());const t=n.du.get(e);t!==null&&(Vo(n.remoteStore,t),n.du=n.du.remove(e),n.Au.delete(t),jo(n))}function mu(n,e,t){for(const r of t)r instanceof Rh?(n.Ru.addReference(r.key,e),sE(n,r)):r instanceof Sh?(N(Bo,"Document no longer in limbo: "+r.key),n.Ru.removeReference(r.key,e),n.Ru.containsKey(r.key)||kh(n,r.key)):x(19791,{wu:r})}function sE(n,e){const t=e.key,r=t.path.canonicalString();n.du.get(t)||n.Eu.has(r)||(N(Bo,"New document in limbo: "+t),n.Eu.add(r),jo(n))}function jo(n){for(;n.Eu.size>0&&n.du.size<n.maxConcurrentLimboResolutions;){const e=n.Eu.values().next().value;n.Eu.delete(e);const t=new M(J.fromString(e)),r=n.fu.next();n.Au.set(r,new Wy(t)),n.du=n.du.insert(t,r),Eh(n.remoteStore,new pt(Be(Ps(t.path)),r,"TargetPurposeLimboResolution",As.ce))}}async function mr(n,e,t){const r=U(n),s=[],o=[],a=[];r.Tu.isEmpty()||(r.Tu.forEach((u,h)=>{a.push(r.pu(h,e,t).then(d=>{if((d||t)&&r.isPrimaryClient){const p=d?!d.fromCache:t?.targetChanges.get(h.targetId)?.current;r.sharedClientState.updateQueryState(h.targetId,p?"current":"not-current")}if(d){s.push(d);const p=Co.As(h.targetId,d);o.push(p)}}))}),await Promise.all(a),r.Pu.H_(s),await async function(h,d){const p=U(h);try{await p.persistence.runTransaction("notifyLocalViewChanges","readwrite",y=>P.forEach(d,E=>P.forEach(E.Es,C=>p.persistence.referenceDelegate.addReference(y,E.targetId,C)).next(()=>P.forEach(E.ds,C=>p.persistence.referenceDelegate.removeReference(y,E.targetId,C)))))}catch(y){if(!En(y))throw y;N(bo,"Failed to update sequence numbers: "+y)}for(const y of d){const E=y.targetId;if(!y.fromCache){const C=p.Ms.get(E),b=C.snapshotVersion,O=C.withLastLimboFreeSnapshotVersion(b);p.Ms=p.Ms.insert(E,O)}}}(r.localStore,o))}async function iE(n,e){const t=U(n);if(!t.currentUser.isEqual(e)){N(Bo,"User change. New user:",e.toKey());const r=await mh(t.localStore,e);t.currentUser=e,function(o,a){o.mu.forEach(u=>{u.forEach(h=>{h.reject(new D(S.CANCELLED,a))})}),o.mu.clear()}(t,"'waitForPendingWrites' promise is rejected due to a user change."),t.sharedClientState.handleUserChange(e,r.removedBatchIds,r.addedBatchIds),await mr(t,r.Ls)}}function oE(n,e){const t=U(n),r=t.Au.get(e);if(r&&r.hu)return $().add(r.key);{let s=$();const o=t.Iu.get(e);if(!o)return s;for(const a of o){const u=t.Tu.get(a);s=s.unionWith(u.view.nu)}return s}}function Dh(n){const e=U(n);return e.remoteStore.remoteSyncer.applyRemoteEvent=Ch.bind(null,e),e.remoteStore.remoteSyncer.getRemoteKeysForTarget=oE.bind(null,e),e.remoteStore.remoteSyncer.rejectListen=tE.bind(null,e),e.Pu.H_=$y.bind(null,e.eventManager),e.Pu.yu=zy.bind(null,e.eventManager),e}function aE(n){const e=U(n);return e.remoteStore.remoteSyncer.applySuccessfulWrite=nE.bind(null,e),e.remoteStore.remoteSyncer.rejectFailedWrite=rE.bind(null,e),e}class gs{constructor(){this.kind="memory",this.synchronizeTabs=!1}async initialize(e){this.serializer=Ns(e.databaseInfo.databaseId),this.sharedClientState=this.Du(e),this.persistence=this.Cu(e),await this.persistence.start(),this.localStore=this.vu(e),this.gcScheduler=this.Fu(e,this.localStore),this.indexBackfillerScheduler=this.Mu(e,this.localStore)}Fu(e,t){return null}Mu(e,t){return null}vu(e){return hy(this.persistence,new cy,e.initialUser,this.serializer)}Cu(e){return new ph(Po.mi,this.serializer)}Du(e){return new yy}async terminate(){this.gcScheduler?.stop(),this.indexBackfillerScheduler?.stop(),this.sharedClientState.shutdown(),await this.persistence.shutdown()}}gs.provider={build:()=>new gs};class cE extends gs{constructor(e){super(),this.cacheSizeBytes=e}Fu(e,t){K(this.persistence.referenceDelegate instanceof ps,46915);const r=this.persistence.referenceDelegate.garbageCollector;return new W_(r,e.asyncQueue,t)}Cu(e){const t=this.cacheSizeBytes!==void 0?Re.withCacheSize(this.cacheSizeBytes):Re.DEFAULT;return new ph(r=>ps.mi(r,t),this.serializer)}}class Yi{async initialize(e,t){this.localStore||(this.localStore=e.localStore,this.sharedClientState=e.sharedClientState,this.datastore=this.createDatastore(t),this.remoteStore=this.createRemoteStore(t),this.eventManager=this.createEventManager(t),this.syncEngine=this.createSyncEngine(t,!e.synchronizeTabs),this.sharedClientState.onlineStateHandler=r=>pu(this.syncEngine,r,1),this.remoteStore.remoteSyncer.handleCredentialChange=iE.bind(null,this.syncEngine),await By(this.remoteStore,this.syncEngine.isPrimaryClient))}createEventManager(e){return function(){return new qy}()}createDatastore(e){const t=Ns(e.databaseInfo.databaseId),r=function(o){return new wy(o)}(e.databaseInfo);return function(o,a,u,h){return new Py(o,a,u,h)}(e.authCredentials,e.appCheckCredentials,r,t)}createRemoteStore(e){return function(r,s,o,a,u){return new by(r,s,o,a,u)}(this.localStore,this.datastore,e.asyncQueue,t=>pu(this.syncEngine,t,0),function(){return cu.v()?new cu:new Ey}())}createSyncEngine(e,t){return function(s,o,a,u,h,d,p){const y=new Ky(s,o,a,u,h,d);return p&&(y.gu=!0),y}(this.localStore,this.remoteStore,this.eventManager,this.sharedClientState,e.initialUser,e.maxConcurrentLimboResolutions,t)}async terminate(){await async function(t){const r=U(t);N($t,"RemoteStore shutting down."),r.Ea.add(5),await pr(r),r.Aa.shutdown(),r.Ra.set("Unknown")}(this.remoteStore),this.datastore?.terminate(),this.eventManager?.terminate()}}Yi.provider={build:()=>new Yi};/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *//**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class qo{constructor(e){this.observer=e,this.muted=!1}next(e){this.muted||this.observer.next&&this.Ou(this.observer.next,e)}error(e){this.muted||(this.observer.error?this.Ou(this.observer.error,e):nt("Uncaught Error in snapshot listener:",e.toString()))}Nu(){this.muted=!0}Ou(e,t){setTimeout(()=>{this.muted||e(t)},0)}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Rt="FirestoreClient";class uE{constructor(e,t,r,s,o){this.authCredentials=e,this.appCheckCredentials=t,this.asyncQueue=r,this.databaseInfo=s,this.user=Te.UNAUTHENTICATED,this.clientId=mo.newId(),this.authCredentialListener=()=>Promise.resolve(),this.appCheckCredentialListener=()=>Promise.resolve(),this._uninitializedComponentsProvider=o,this.authCredentials.start(r,async a=>{N(Rt,"Received user=",a.uid),await this.authCredentialListener(a),this.user=a}),this.appCheckCredentials.start(r,a=>(N(Rt,"Received new app check token=",a),this.appCheckCredentialListener(a,this.user)))}get configuration(){return{asyncQueue:this.asyncQueue,databaseInfo:this.databaseInfo,clientId:this.clientId,authCredentials:this.authCredentials,appCheckCredentials:this.appCheckCredentials,initialUser:this.user,maxConcurrentLimboResolutions:100}}setCredentialChangeListener(e){this.authCredentialListener=e}setAppCheckTokenChangeListener(e){this.appCheckCredentialListener=e}terminate(){this.asyncQueue.enterRestrictedMode();const e=new Ye;return this.asyncQueue.enqueueAndForgetEvenWhileRestricted(async()=>{try{this._onlineComponents&&await this._onlineComponents.terminate(),this._offlineComponents&&await this._offlineComponents.terminate(),this.authCredentials.shutdown(),this.appCheckCredentials.shutdown(),e.resolve()}catch(t){const r=Mo(t,"Failed to shutdown persistence");e.reject(r)}}),e.promise}}async function Si(n,e){n.asyncQueue.verifyOperationInProgress(),N(Rt,"Initializing OfflineComponentProvider");const t=n.configuration;await e.initialize(t);let r=t.initialUser;n.setCredentialChangeListener(async s=>{r.isEqual(s)||(await mh(e.localStore,s),r=s)}),e.persistence.setDatabaseDeletedListener(()=>n.terminate()),n._offlineComponents=e}async function gu(n,e){n.asyncQueue.verifyOperationInProgress();const t=await lE(n);N(Rt,"Initializing OnlineComponentProvider"),await e.initialize(t,n.configuration),n.setCredentialChangeListener(r=>lu(e.remoteStore,r)),n.setAppCheckTokenChangeListener((r,s)=>lu(e.remoteStore,s)),n._onlineComponents=e}async function lE(n){if(!n._offlineComponents)if(n._uninitializedComponentsProvider){N(Rt,"Using user provided OfflineComponentProvider");try{await Si(n,n._uninitializedComponentsProvider._offline)}catch(e){const t=e;if(!function(s){return s.name==="FirebaseError"?s.code===S.FAILED_PRECONDITION||s.code===S.UNIMPLEMENTED:!(typeof DOMException<"u"&&s instanceof DOMException)||s.code===22||s.code===20||s.code===11}(t))throw t;an("Error using user provided cache. Falling back to memory cache: "+t),await Si(n,new gs)}}else N(Rt,"Using default OfflineComponentProvider"),await Si(n,new cE(void 0));return n._offlineComponents}async function Nh(n){return n._onlineComponents||(n._uninitializedComponentsProvider?(N(Rt,"Using user provided OnlineComponentProvider"),await gu(n,n._uninitializedComponentsProvider._online)):(N(Rt,"Using default OnlineComponentProvider"),await gu(n,new Yi))),n._onlineComponents}function hE(n){return Nh(n).then(e=>e.syncEngine)}async function _s(n){const e=await Nh(n),t=e.eventManager;return t.onListen=Qy.bind(null,e.syncEngine),t.onUnlisten=Yy.bind(null,e.syncEngine),t.onFirstRemoteStoreListen=Jy.bind(null,e.syncEngine),t.onLastRemoteStoreUnlisten=Zy.bind(null,e.syncEngine),t}function dE(n,e,t={}){const r=new Ye;return n.asyncQueue.enqueueAndForget(async()=>function(o,a,u,h,d){const p=new qo({next:E=>{p.Nu(),a.enqueueAndForget(()=>xo(o,y));const C=E.docs.has(u);!C&&E.fromCache?d.reject(new D(S.UNAVAILABLE,"Failed to get document because the client is offline.")):C&&E.fromCache&&h&&h.source==="server"?d.reject(new D(S.UNAVAILABLE,'Failed to get document from server. (However, this document does exist in the local cache. Run again without setting source to "server" to retrieve the cached document.)')):d.resolve(E)},error:E=>d.reject(E)}),y=new Uo(Ps(u.path),p,{includeMetadataChanges:!0,qa:!0});return Lo(o,y)}(await _s(n),n.asyncQueue,e,t,r)),r.promise}function fE(n,e,t={}){const r=new Ye;return n.asyncQueue.enqueueAndForget(async()=>function(o,a,u,h,d){const p=new qo({next:E=>{p.Nu(),a.enqueueAndForget(()=>xo(o,y)),E.fromCache&&h.source==="server"?d.reject(new D(S.UNAVAILABLE,'Failed to get documents from server. (However, these documents may exist in the local cache. Run again without setting source to "server" to retrieve the cached documents.)')):d.resolve(E)},error:E=>d.reject(E)}),y=new Uo(u,p,{includeMetadataChanges:!0,qa:!0});return Lo(o,y)}(await _s(n),n.asyncQueue,e,t,r)),r.promise}/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Oh(n){const e={};return n.timeoutSeconds!==void 0&&(e.timeoutSeconds=n.timeoutSeconds),e}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const _u=new Map;/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Mh="firestore.googleapis.com",yu=!0;class Eu{constructor(e){if(e.host===void 0){if(e.ssl!==void 0)throw new D(S.INVALID_ARGUMENT,"Can't provide ssl option if host option is not set");this.host=Mh,this.ssl=yu}else this.host=e.host,this.ssl=e.ssl??yu;if(this.isUsingEmulator=e.emulatorOptions!==void 0,this.credentials=e.credentials,this.ignoreUndefinedProperties=!!e.ignoreUndefinedProperties,this.localCache=e.localCache,e.cacheSizeBytes===void 0)this.cacheSizeBytes=fh;else{if(e.cacheSizeBytes!==-1&&e.cacheSizeBytes<H_)throw new D(S.INVALID_ARGUMENT,"cacheSizeBytes must be at least 1048576");this.cacheSizeBytes=e.cacheSizeBytes}Cg("experimentalForceLongPolling",e.experimentalForceLongPolling,"experimentalAutoDetectLongPolling",e.experimentalAutoDetectLongPolling),this.experimentalForceLongPolling=!!e.experimentalForceLongPolling,this.experimentalForceLongPolling?this.experimentalAutoDetectLongPolling=!1:e.experimentalAutoDetectLongPolling===void 0?this.experimentalAutoDetectLongPolling=!0:this.experimentalAutoDetectLongPolling=!!e.experimentalAutoDetectLongPolling,this.experimentalLongPollingOptions=Oh(e.experimentalLongPollingOptions??{}),function(r){if(r.timeoutSeconds!==void 0){if(isNaN(r.timeoutSeconds))throw new D(S.INVALID_ARGUMENT,`invalid long polling timeout: ${r.timeoutSeconds} (must not be NaN)`);if(r.timeoutSeconds<5)throw new D(S.INVALID_ARGUMENT,`invalid long polling timeout: ${r.timeoutSeconds} (minimum allowed value is 5)`);if(r.timeoutSeconds>30)throw new D(S.INVALID_ARGUMENT,`invalid long polling timeout: ${r.timeoutSeconds} (maximum allowed value is 30)`)}}(this.experimentalLongPollingOptions),this.useFetchStreams=!!e.useFetchStreams}isEqual(e){return this.host===e.host&&this.ssl===e.ssl&&this.credentials===e.credentials&&this.cacheSizeBytes===e.cacheSizeBytes&&this.experimentalForceLongPolling===e.experimentalForceLongPolling&&this.experimentalAutoDetectLongPolling===e.experimentalAutoDetectLongPolling&&function(r,s){return r.timeoutSeconds===s.timeoutSeconds}(this.experimentalLongPollingOptions,e.experimentalLongPollingOptions)&&this.ignoreUndefinedProperties===e.ignoreUndefinedProperties&&this.useFetchStreams===e.useFetchStreams}}class Ls{constructor(e,t,r,s){this._authCredentials=e,this._appCheckCredentials=t,this._databaseId=r,this._app=s,this.type="firestore-lite",this._persistenceKey="(lite)",this._settings=new Eu({}),this._settingsFrozen=!1,this._emulatorOptions={},this._terminateTask="notTerminated"}get app(){if(!this._app)throw new D(S.FAILED_PRECONDITION,"Firestore was not initialized using the Firebase SDK. 'app' is not available");return this._app}get _initialized(){return this._settingsFrozen}get _terminated(){return this._terminateTask!=="notTerminated"}_setSettings(e){if(this._settingsFrozen)throw new D(S.FAILED_PRECONDITION,"Firestore has already been started and its settings can no longer be changed. You can only modify settings before calling any other methods on a Firestore object.");this._settings=new Eu(e),this._emulatorOptions=e.emulatorOptions||{},e.credentials!==void 0&&(this._authCredentials=function(r){if(!r)return new yg;switch(r.type){case"firstParty":return new vg(r.sessionIndex||"0",r.iamToken||null,r.authTokenFactory||null);case"provider":return r.client;default:throw new D(S.INVALID_ARGUMENT,"makeAuthCredentialsProvider failed due to invalid credential type")}}(e.credentials))}_getSettings(){return this._settings}_getEmulatorOptions(){return this._emulatorOptions}_freezeSettings(){return this._settingsFrozen=!0,this._settings}_delete(){return this._terminateTask==="notTerminated"&&(this._terminateTask=this._terminate()),this._terminateTask}async _restart(){this._terminateTask==="notTerminated"?await this._terminate():this._terminateTask="notTerminated"}toJSON(){return{app:this._app,databaseId:this._databaseId,settings:this._settings}}_terminate(){return function(t){const r=_u.get(t);r&&(N("ComponentProvider","Removing Datastore"),_u.delete(t),r.terminate())}(this),Promise.resolve()}}function pE(n,e,t,r={}){n=Pe(n,Ls);const s=fn(e),o=n._getSettings(),a={...o,emulatorOptions:n._getEmulatorOptions()},u=`${e}:${t}`;s&&(Du(`https://${u}`),Nu("Firestore",!0)),o.host!==Mh&&o.host!==u&&an("Host has been set in both settings() and connectFirestoreEmulator(), emulator host will be used.");const h={...o,host:u,ssl:s,emulatorOptions:r};if(!Bt(h,a)&&(n._setSettings(h),r.mockUserToken)){let d,p;if(typeof r.mockUserToken=="string")d=r.mockUserToken,p=Te.MOCK_USER;else{d=zd(r.mockUserToken,n._app?.options.projectId);const y=r.mockUserToken.sub||r.mockUserToken.user_id;if(!y)throw new D(S.INVALID_ARGUMENT,"mockUserToken must contain 'sub' or 'user_id' field!");p=new Te(y)}n._authCredentials=new Eg(new Rl(d,p))}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Ct{constructor(e,t,r){this.converter=t,this._query=r,this.type="query",this.firestore=e}withConverter(e){return new Ct(this.firestore,e,this._query)}}class te{constructor(e,t,r){this.converter=t,this._key=r,this.type="document",this.firestore=e}get _path(){return this._key.path}get id(){return this._key.path.lastSegment()}get path(){return this._key.path.canonicalString()}get parent(){return new Et(this.firestore,this.converter,this._key.path.popLast())}withConverter(e){return new te(this.firestore,e,this._key)}toJSON(){return{type:te._jsonSchemaVersion,referencePath:this._key.toString()}}static fromJSON(e,t,r){if(hr(t,te._jsonSchema))return new te(e,r||null,new M(J.fromString(t.referencePath)))}}te._jsonSchemaVersion="firestore/documentReference/1.0",te._jsonSchema={type:ie("string",te._jsonSchemaVersion),referencePath:ie("string")};class Et extends Ct{constructor(e,t,r){super(e,t,Ps(r)),this._path=r,this.type="collection"}get id(){return this._query.path.lastSegment()}get path(){return this._query.path.canonicalString()}get parent(){const e=this._path.popLast();return e.isEmpty()?null:new te(this.firestore,null,new M(e))}withConverter(e){return new Et(this.firestore,e,this._path)}}function FE(n,e,...t){if(n=ce(n),Sl("collection","path",e),n instanceof Ls){const r=J.fromString(e,...t);return Dc(r),new Et(n,null,r)}{if(!(n instanceof te||n instanceof Et))throw new D(S.INVALID_ARGUMENT,"Expected first argument to collection() to be a CollectionReference, a DocumentReference or FirebaseFirestore");const r=n._path.child(J.fromString(e,...t));return Dc(r),new Et(n.firestore,null,r)}}function Lh(n,e,...t){if(n=ce(n),arguments.length===1&&(e=mo.newId()),Sl("doc","path",e),n instanceof Ls){const r=J.fromString(e,...t);return kc(r),new te(n,null,new M(r))}{if(!(n instanceof te||n instanceof Et))throw new D(S.INVALID_ARGUMENT,"Expected first argument to collection() to be a CollectionReference, a DocumentReference or FirebaseFirestore");const r=n._path.child(J.fromString(e,...t));return kc(r),new te(n.firestore,n instanceof Et?n.converter:null,new M(r))}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const Tu="AsyncQueue";class Iu{constructor(e=Promise.resolve()){this.Xu=[],this.ec=!1,this.tc=[],this.nc=null,this.rc=!1,this.sc=!1,this.oc=[],this.M_=new _h(this,"async_queue_retry"),this._c=()=>{const r=Ri();r&&N(Tu,"Visibility state changed to "+r.visibilityState),this.M_.w_()},this.ac=e;const t=Ri();t&&typeof t.addEventListener=="function"&&t.addEventListener("visibilitychange",this._c)}get isShuttingDown(){return this.ec}enqueueAndForget(e){this.enqueue(e)}enqueueAndForgetEvenWhileRestricted(e){this.uc(),this.cc(e)}enterRestrictedMode(e){if(!this.ec){this.ec=!0,this.sc=e||!1;const t=Ri();t&&typeof t.removeEventListener=="function"&&t.removeEventListener("visibilitychange",this._c)}}enqueue(e){if(this.uc(),this.ec)return new Promise(()=>{});const t=new Ye;return this.cc(()=>this.ec&&this.sc?Promise.resolve():(e().then(t.resolve,t.reject),t.promise)).then(()=>t.promise)}enqueueRetryable(e){this.enqueueAndForget(()=>(this.Xu.push(e),this.lc()))}async lc(){if(this.Xu.length!==0){try{await this.Xu[0](),this.Xu.shift(),this.M_.reset()}catch(e){if(!En(e))throw e;N(Tu,"Operation failed with retryable error: "+e)}this.Xu.length>0&&this.M_.p_(()=>this.lc())}}cc(e){const t=this.ac.then(()=>(this.rc=!0,e().catch(r=>{throw this.nc=r,this.rc=!1,nt("INTERNAL UNHANDLED ERROR: ",vu(r)),r}).then(r=>(this.rc=!1,r))));return this.ac=t,t}enqueueAfterDelay(e,t,r){this.uc(),this.oc.indexOf(e)>-1&&(t=0);const s=Oo.createAndSchedule(this,e,t,r,o=>this.hc(o));return this.tc.push(s),s}uc(){this.nc&&x(47125,{Pc:vu(this.nc)})}verifyOperationInProgress(){}async Tc(){let e;do e=this.ac,await e;while(e!==this.ac)}Ic(e){for(const t of this.tc)if(t.timerId===e)return!0;return!1}Ec(e){return this.Tc().then(()=>{this.tc.sort((t,r)=>t.targetTimeMs-r.targetTimeMs);for(const t of this.tc)if(t.skipDelay(),e!=="all"&&t.timerId===e)break;return this.Tc()})}dc(e){this.oc.push(e)}hc(e){const t=this.tc.indexOf(e);this.tc.splice(t,1)}}function vu(n){let e=n.message||"";return n.stack&&(e=n.stack.includes(n.message)?n.stack:n.message+`
`+n.stack),e}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function wu(n){return function(t,r){if(typeof t!="object"||t===null)return!1;const s=t;for(const o of r)if(o in s&&typeof s[o]=="function")return!0;return!1}(n,["next","error","complete"])}class st extends Ls{constructor(e,t,r,s){super(e,t,r,s),this.type="firestore",this._queue=new Iu,this._persistenceKey=s?.name||"[DEFAULT]"}async _terminate(){if(this._firestoreClient){const e=this._firestoreClient.terminate();this._queue=new Iu(e),this._firestoreClient=void 0,await e}}}function mE(n,e){const t=typeof n=="object"?n:xu(),r=typeof n=="string"?n:us,s=no(t,"firestore").getImmediate({identifier:r});if(!s._initialized){const o=qd("firestore");o&&pE(s,...o)}return s}function xs(n){if(n._terminated)throw new D(S.FAILED_PRECONDITION,"The client has already been terminated.");return n._firestoreClient||gE(n),n._firestoreClient}function gE(n){const e=n._freezeSettings(),t=function(s,o,a,u){return new Ug(s,o,a,u.host,u.ssl,u.experimentalForceLongPolling,u.experimentalAutoDetectLongPolling,Oh(u.experimentalLongPollingOptions),u.useFetchStreams,u.isUsingEmulator)}(n._databaseId,n._app?.options.appId||"",n._persistenceKey,e);n._componentsProvider||e.localCache?._offlineComponentProvider&&e.localCache?._onlineComponentProvider&&(n._componentsProvider={_offline:e.localCache._offlineComponentProvider,_online:e.localCache._onlineComponentProvider}),n._firestoreClient=new uE(n._authCredentials,n._appCheckCredentials,n._queue,t,n._componentsProvider&&function(s){const o=s?._online.build();return{_offline:s?._offline.build(o),_online:o}}(n._componentsProvider))}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Ve{constructor(e){this._byteString=e}static fromBase64String(e){try{return new Ve(fe.fromBase64String(e))}catch(t){throw new D(S.INVALID_ARGUMENT,"Failed to construct data from Base64 string: "+t)}}static fromUint8Array(e){return new Ve(fe.fromUint8Array(e))}toBase64(){return this._byteString.toBase64()}toUint8Array(){return this._byteString.toUint8Array()}toString(){return"Bytes(base64: "+this.toBase64()+")"}isEqual(e){return this._byteString.isEqual(e._byteString)}toJSON(){return{type:Ve._jsonSchemaVersion,bytes:this.toBase64()}}static fromJSON(e){if(hr(e,Ve._jsonSchema))return Ve.fromBase64String(e.bytes)}}Ve._jsonSchemaVersion="firestore/bytes/1.0",Ve._jsonSchema={type:ie("string",Ve._jsonSchemaVersion),bytes:ie("string")};/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Fs{constructor(...e){for(let t=0;t<e.length;++t)if(e[t].length===0)throw new D(S.INVALID_ARGUMENT,"Invalid field name at argument $(i + 1). Field names must not be empty.");this._internalPath=new de(e)}isEqual(e){return this._internalPath.isEqual(e._internalPath)}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class Us{constructor(e){this._methodName=e}}/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class qe{constructor(e,t){if(!isFinite(e)||e<-90||e>90)throw new D(S.INVALID_ARGUMENT,"Latitude must be a number between -90 and 90, but was: "+e);if(!isFinite(t)||t<-180||t>180)throw new D(S.INVALID_ARGUMENT,"Longitude must be a number between -180 and 180, but was: "+t);this._lat=e,this._long=t}get latitude(){return this._lat}get longitude(){return this._long}isEqual(e){return this._lat===e._lat&&this._long===e._long}_compareTo(e){return q(this._lat,e._lat)||q(this._long,e._long)}toJSON(){return{latitude:this._lat,longitude:this._long,type:qe._jsonSchemaVersion}}static fromJSON(e){if(hr(e,qe._jsonSchema))return new qe(e.latitude,e.longitude)}}qe._jsonSchemaVersion="firestore/geoPoint/1.0",qe._jsonSchema={type:ie("string",qe._jsonSchemaVersion),latitude:ie("number"),longitude:ie("number")};/**
 * @license
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class $e{constructor(e){this._values=(e||[]).map(t=>t)}toArray(){return this._values.map(e=>e)}isEqual(e){return function(r,s){if(r.length!==s.length)return!1;for(let o=0;o<r.length;++o)if(r[o]!==s[o])return!1;return!0}(this._values,e._values)}toJSON(){return{type:$e._jsonSchemaVersion,vectorValues:this._values}}static fromJSON(e){if(hr(e,$e._jsonSchema)){if(Array.isArray(e.vectorValues)&&e.vectorValues.every(t=>typeof t=="number"))return new $e(e.vectorValues);throw new D(S.INVALID_ARGUMENT,"Expected 'vectorValues' field to be a number array")}}}$e._jsonSchemaVersion="firestore/vectorValue/1.0",$e._jsonSchema={type:ie("string",$e._jsonSchemaVersion),vectorValues:ie("object")};/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */const _E=/^__.*__$/;class yE{constructor(e,t,r){this.data=e,this.fieldMask=t,this.fieldTransforms=r}toMutation(e,t){return this.fieldMask!==null?new Pt(e,this.data,this.fieldMask,t,this.fieldTransforms):new dr(e,this.data,t,this.fieldTransforms)}}class xh{constructor(e,t,r){this.data=e,this.fieldMask=t,this.fieldTransforms=r}toMutation(e,t){return new Pt(e,this.data,this.fieldMask,t,this.fieldTransforms)}}function Fh(n){switch(n){case 0:case 2:case 1:return!0;case 3:case 4:return!1;default:throw x(40011,{Ac:n})}}class $o{constructor(e,t,r,s,o,a){this.settings=e,this.databaseId=t,this.serializer=r,this.ignoreUndefinedProperties=s,o===void 0&&this.Rc(),this.fieldTransforms=o||[],this.fieldMask=a||[]}get path(){return this.settings.path}get Ac(){return this.settings.Ac}Vc(e){return new $o({...this.settings,...e},this.databaseId,this.serializer,this.ignoreUndefinedProperties,this.fieldTransforms,this.fieldMask)}mc(e){const t=this.path?.child(e),r=this.Vc({path:t,fc:!1});return r.gc(e),r}yc(e){const t=this.path?.child(e),r=this.Vc({path:t,fc:!1});return r.Rc(),r}wc(e){return this.Vc({path:void 0,fc:!0})}Sc(e){return ys(e,this.settings.methodName,this.settings.bc||!1,this.path,this.settings.Dc)}contains(e){return this.fieldMask.find(t=>e.isPrefixOf(t))!==void 0||this.fieldTransforms.find(t=>e.isPrefixOf(t.field))!==void 0}Rc(){if(this.path)for(let e=0;e<this.path.length;e++)this.gc(this.path.get(e))}gc(e){if(e.length===0)throw this.Sc("Document fields must not be empty");if(Fh(this.Ac)&&_E.test(e))throw this.Sc('Document fields cannot begin and end with "__"')}}class EE{constructor(e,t,r){this.databaseId=e,this.ignoreUndefinedProperties=t,this.serializer=r||Ns(e)}Cc(e,t,r,s=!1){return new $o({Ac:e,methodName:t,Dc:r,path:de.emptyPath(),fc:!1,bc:s},this.databaseId,this.serializer,this.ignoreUndefinedProperties)}}function Bs(n){const e=n._freezeSettings(),t=Ns(n._databaseId);return new EE(n._databaseId,!!e.ignoreUndefinedProperties,t)}function Uh(n,e,t,r,s,o={}){const a=n.Cc(o.merge||o.mergeFields?2:0,e,t,s);Ho("Data must be an object, but it was:",a,r);const u=Bh(r,a);let h,d;if(o.merge)h=new be(a.fieldMask),d=a.fieldTransforms;else if(o.mergeFields){const p=[];for(const y of o.mergeFields){const E=Zi(e,y,t);if(!a.contains(E))throw new D(S.INVALID_ARGUMENT,`Field '${E}' is specified in your field mask but missing from your input data.`);qh(p,E)||p.push(E)}h=new be(p),d=a.fieldTransforms.filter(y=>h.covers(y.field))}else h=null,d=a.fieldTransforms;return new yE(new Se(u),h,d)}class js extends Us{_toFieldTransform(e){if(e.Ac!==2)throw e.Ac===1?e.Sc(`${this._methodName}() can only appear at the top level of your update data`):e.Sc(`${this._methodName}() cannot be used with set() unless you pass {merge:true}`);return e.fieldMask.push(e.path),null}isEqual(e){return e instanceof js}}class zo extends Us{_toFieldTransform(e){return new h_(e.path,new sr)}isEqual(e){return e instanceof zo}}function TE(n,e,t,r){const s=n.Cc(1,e,t);Ho("Data must be an object, but it was:",s,r);const o=[],a=Se.empty();St(r,(h,d)=>{const p=Go(e,h,t);d=ce(d);const y=s.yc(p);if(d instanceof js)o.push(p);else{const E=gr(d,y);E!=null&&(o.push(p),a.set(p,E))}});const u=new be(o);return new xh(a,u,s.fieldTransforms)}function IE(n,e,t,r,s,o){const a=n.Cc(1,e,t),u=[Zi(e,r,t)],h=[s];if(o.length%2!=0)throw new D(S.INVALID_ARGUMENT,`Function ${e}() needs to be called with an even number of arguments that alternate between field names and values.`);for(let E=0;E<o.length;E+=2)u.push(Zi(e,o[E])),h.push(o[E+1]);const d=[],p=Se.empty();for(let E=u.length-1;E>=0;--E)if(!qh(d,u[E])){const C=u[E];let b=h[E];b=ce(b);const O=a.yc(C);if(b instanceof js)d.push(C);else{const k=gr(b,O);k!=null&&(d.push(C),p.set(C,k))}}const y=new be(d);return new xh(p,y,a.fieldTransforms)}function vE(n,e,t,r=!1){return gr(t,n.Cc(r?4:3,e))}function gr(n,e){if(jh(n=ce(n)))return Ho("Unsupported field value:",e,n),Bh(n,e);if(n instanceof Us)return function(r,s){if(!Fh(s.Ac))throw s.Sc(`${r._methodName}() can only be used with update() and set()`);if(!s.path)throw s.Sc(`${r._methodName}() is not currently supported inside arrays`);const o=r._toFieldTransform(s);o&&s.fieldTransforms.push(o)}(n,e),null;if(n===void 0&&e.ignoreUndefinedProperties)return null;if(e.path&&e.fieldMask.push(e.path),n instanceof Array){if(e.settings.fc&&e.Ac!==4)throw e.Sc("Nested arrays are not supported");return function(r,s){const o=[];let a=0;for(const u of r){let h=gr(u,s.wc(a));h==null&&(h={nullValue:"NULL_VALUE"}),o.push(h),a++}return{arrayValue:{values:o}}}(n,e)}return function(r,s){if((r=ce(r))===null)return{nullValue:"NULL_VALUE"};if(typeof r=="number")return c_(s.serializer,r);if(typeof r=="boolean")return{booleanValue:r};if(typeof r=="string")return{stringValue:r};if(r instanceof Date){const o=Y.fromDate(r);return{timestampValue:fs(s.serializer,o)}}if(r instanceof Y){const o=new Y(r.seconds,1e3*Math.floor(r.nanoseconds/1e3));return{timestampValue:fs(s.serializer,o)}}if(r instanceof qe)return{geoPointValue:{latitude:r.latitude,longitude:r.longitude}};if(r instanceof Ve)return{bytesValue:oh(s.serializer,r._byteString)};if(r instanceof te){const o=s.databaseId,a=r.firestore._databaseId;if(!a.isEqual(o))throw s.Sc(`Document reference is for database ${a.projectId}/${a.database} but should be for database ${o.projectId}/${o.database}`);return{referenceValue:Ro(r.firestore._databaseId||s.databaseId,r._key.path)}}if(r instanceof $e)return function(a,u){return{mapValue:{fields:{[Ml]:{stringValue:Ll},[ls]:{arrayValue:{values:a.toArray().map(d=>{if(typeof d!="number")throw u.Sc("VectorValues must only contain numeric values.");return Io(u.serializer,d)})}}}}}}(r,s);throw s.Sc(`Unsupported field value: ${ws(r)}`)}(n,e)}function Bh(n,e){const t={};return bl(n)?e.path&&e.path.length>0&&e.fieldMask.push(e.path):St(n,(r,s)=>{const o=gr(s,e.mc(r));o!=null&&(t[r]=o)}),{mapValue:{fields:t}}}function jh(n){return!(typeof n!="object"||n===null||n instanceof Array||n instanceof Date||n instanceof Y||n instanceof qe||n instanceof Ve||n instanceof te||n instanceof Us||n instanceof $e)}function Ho(n,e,t){if(!jh(t)||!Pl(t)){const r=ws(t);throw r==="an object"?e.Sc(n+" a custom object"):e.Sc(n+" "+r)}}function Zi(n,e,t){if((e=ce(e))instanceof Fs)return e._internalPath;if(typeof e=="string")return Go(n,e);throw ys("Field path arguments must be of type string or ",n,!1,void 0,t)}const wE=new RegExp("[~\\*/\\[\\]]");function Go(n,e,t){if(e.search(wE)>=0)throw ys(`Invalid field path (${e}). Paths must not contain '~', '*', '/', '[', or ']'`,n,!1,void 0,t);try{return new Fs(...e.split("."))._internalPath}catch{throw ys(`Invalid field path (${e}). Paths must not be empty, begin with '.', end with '.', or contain '..'`,n,!1,void 0,t)}}function ys(n,e,t,r,s){const o=r&&!r.isEmpty(),a=s!==void 0;let u=`Function ${e}() called with invalid data`;t&&(u+=" (via `toFirestore()`)"),u+=". ";let h="";return(o||a)&&(h+=" (found",o&&(h+=` in field ${r}`),a&&(h+=` in document ${s}`),h+=")"),new D(S.INVALID_ARGUMENT,u+n+h)}function qh(n,e){return n.some(t=>t.isEqual(e))}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */class $h{constructor(e,t,r,s,o){this._firestore=e,this._userDataWriter=t,this._key=r,this._document=s,this._converter=o}get id(){return this._key.path.lastSegment()}get ref(){return new te(this._firestore,this._converter,this._key)}exists(){return this._document!==null}data(){if(this._document){if(this._converter){const e=new AE(this._firestore,this._userDataWriter,this._key,this._document,null);return this._converter.fromFirestore(e)}return this._userDataWriter.convertValue(this._document.data.value)}}get(e){if(this._document){const t=this._document.data.field(qs("DocumentSnapshot.get",e));if(t!==null)return this._userDataWriter.convertValue(t)}}}class AE extends $h{data(){return super.data()}}function qs(n,e){return typeof e=="string"?Go(n,e):e instanceof Fs?e._internalPath:e._delegate._internalPath}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function zh(n){if(n.limitType==="L"&&n.explicitOrderBy.length===0)throw new D(S.UNIMPLEMENTED,"limitToLast() queries require specifying at least one orderBy() clause")}class Wo{}class Hh extends Wo{}function UE(n,e,...t){let r=[];e instanceof Wo&&r.push(e),r=r.concat(t),function(o){const a=o.filter(h=>h instanceof Ko).length,u=o.filter(h=>h instanceof $s).length;if(a>1||a>0&&u>0)throw new D(S.INVALID_ARGUMENT,"InvalidQuery. When using composite filters, you cannot use more than one filter at the top level. Consider nesting the multiple filters within an `and(...)` statement. For example: change `query(query, where(...), or(...))` to `query(query, and(where(...), or(...)))`.")}(r);for(const s of r)n=s._apply(n);return n}class $s extends Hh{constructor(e,t,r){super(),this._field=e,this._op=t,this._value=r,this.type="where"}static _create(e,t,r){return new $s(e,t,r)}_apply(e){const t=this._parse(e);return Gh(e._query,t),new Ct(e.firestore,e.converter,qi(e._query,t))}_parse(e){const t=Bs(e.firestore);return function(o,a,u,h,d,p,y){let E;if(d.isKeyField()){if(p==="array-contains"||p==="array-contains-any")throw new D(S.INVALID_ARGUMENT,`Invalid Query. You can't perform '${p}' queries on documentId().`);if(p==="in"||p==="not-in"){Ru(y,p);const b=[];for(const O of y)b.push(Au(h,o,O));E={arrayValue:{values:b}}}else E=Au(h,o,y)}else p!=="in"&&p!=="not-in"&&p!=="array-contains-any"||Ru(y,p),E=vE(u,a,y,p==="in"||p==="not-in");return se.create(d,p,E)}(e._query,"where",t,e.firestore._databaseId,this._field,this._op,this._value)}}function BE(n,e,t){const r=e,s=qs("where",n);return $s._create(s,r,t)}class Ko extends Wo{constructor(e,t){super(),this.type=e,this._queryConstraints=t}static _create(e,t){return new Ko(e,t)}_parse(e){const t=this._queryConstraints.map(r=>r._parse(e)).filter(r=>r.getFilters().length>0);return t.length===1?t[0]:Le.create(t,this._getOperator())}_apply(e){const t=this._parse(e);return t.getFilters().length===0?e:(function(s,o){let a=s;const u=o.getFlattenedFilters();for(const h of u)Gh(a,h),a=qi(a,h)}(e._query,t),new Ct(e.firestore,e.converter,qi(e._query,t)))}_getQueryConstraints(){return this._queryConstraints}_getOperator(){return this.type==="and"?"and":"or"}}class Qo extends Hh{constructor(e,t){super(),this._field=e,this._direction=t,this.type="orderBy"}static _create(e,t){return new Qo(e,t)}_apply(e){const t=function(s,o,a){if(s.startAt!==null)throw new D(S.INVALID_ARGUMENT,"Invalid query. You must not call startAt() or startAfter() before calling orderBy().");if(s.endAt!==null)throw new D(S.INVALID_ARGUMENT,"Invalid query. You must not call endAt() or endBefore() before calling orderBy().");return new rr(o,a)}(e._query,this._field,this._direction);return new Ct(e.firestore,e.converter,function(s,o){const a=s.explicitOrderBy.concat([o]);return new Tn(s.path,s.collectionGroup,a,s.filters.slice(),s.limit,s.limitType,s.startAt,s.endAt)}(e._query,t))}}function jE(n,e="asc"){const t=e,r=qs("orderBy",n);return Qo._create(r,t)}function Au(n,e,t){if(typeof(t=ce(t))=="string"){if(t==="")throw new D(S.INVALID_ARGUMENT,"Invalid query. When querying with documentId(), you must provide a valid document ID, but it was an empty string.");if(!zl(e)&&t.indexOf("/")!==-1)throw new D(S.INVALID_ARGUMENT,`Invalid query. When querying a collection by documentId(), you must provide a plain document ID, but '${t}' contains a '/' character.`);const r=e.path.child(J.fromString(t));if(!M.isDocumentKey(r))throw new D(S.INVALID_ARGUMENT,`Invalid query. When querying a collection group by documentId(), the value provided must result in a valid document path, but '${r}' is not because it has an odd number of segments (${r.length}).`);return Bc(n,new M(r))}if(t instanceof te)return Bc(n,t._key);throw new D(S.INVALID_ARGUMENT,`Invalid query. When querying with documentId(), you must provide a valid string or a DocumentReference, but it was: ${ws(t)}.`)}function Ru(n,e){if(!Array.isArray(n)||n.length===0)throw new D(S.INVALID_ARGUMENT,`Invalid Query. A non-empty array is required for '${e.toString()}' filters.`)}function Gh(n,e){const t=function(s,o){for(const a of s)for(const u of a.getFlattenedFilters())if(o.indexOf(u.op)>=0)return u.op;return null}(n.filters,function(s){switch(s){case"!=":return["!=","not-in"];case"array-contains-any":case"in":return["not-in"];case"not-in":return["array-contains-any","in","not-in","!="];default:return[]}}(e.op));if(t!==null)throw t===e.op?new D(S.INVALID_ARGUMENT,`Invalid query. You cannot use more than one '${e.op.toString()}' filter.`):new D(S.INVALID_ARGUMENT,`Invalid query. You cannot use '${e.op.toString()}' filters with '${t.toString()}' filters.`)}class RE{convertValue(e,t="none"){switch(wt(e)){case 0:return null;case 1:return e.booleanValue;case 2:return ne(e.integerValue||e.doubleValue);case 3:return this.convertTimestamp(e.timestampValue);case 4:return this.convertServerTimestamp(e,t);case 5:return e.stringValue;case 6:return this.convertBytes(vt(e.bytesValue));case 7:return this.convertReference(e.referenceValue);case 8:return this.convertGeoPoint(e.geoPointValue);case 9:return this.convertArray(e.arrayValue,t);case 11:return this.convertObject(e.mapValue,t);case 10:return this.convertVectorValue(e.mapValue);default:throw x(62114,{value:e})}}convertObject(e,t){return this.convertObjectMap(e.fields,t)}convertObjectMap(e,t="none"){const r={};return St(e,(s,o)=>{r[s]=this.convertValue(o,t)}),r}convertVectorValue(e){const t=e.fields?.[ls].arrayValue?.values?.map(r=>ne(r.doubleValue));return new $e(t)}convertGeoPoint(e){return new qe(ne(e.latitude),ne(e.longitude))}convertArray(e,t){return(e.values||[]).map(r=>this.convertValue(r,t))}convertServerTimestamp(e,t){switch(t){case"previous":const r=Ss(e);return r==null?null:this.convertValue(r,t);case"estimate":return this.convertTimestamp(er(e));default:return null}}convertTimestamp(e){const t=It(e);return new Y(t.seconds,t.nanos)}convertDocumentKey(e,t){const r=J.fromString(e);K(dh(r),9688,{name:e});const s=new tr(r.get(1),r.get(3)),o=new M(r.popFirst(5));return s.isEqual(t)||nt(`Document ${o} contains a document reference within a different database (${s.projectId}/${s.database}) which is not supported. It will be treated as a reference in the current database (${t.projectId}/${t.database}) instead.`),o}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function Wh(n,e,t){let r;return r=n?t&&(t.merge||t.mergeFields)?n.toFirestore(e,t):n.toFirestore(e):e,r}class qn{constructor(e,t){this.hasPendingWrites=e,this.fromCache=t}isEqual(e){return this.hasPendingWrites===e.hasPendingWrites&&this.fromCache===e.fromCache}}class Ft extends $h{constructor(e,t,r,s,o,a){super(e,t,r,s,a),this._firestore=e,this._firestoreImpl=e,this.metadata=o}exists(){return super.exists()}data(e={}){if(this._document){if(this._converter){const t=new es(this._firestore,this._userDataWriter,this._key,this._document,this.metadata,null);return this._converter.fromFirestore(t,e)}return this._userDataWriter.convertValue(this._document.data.value,e.serverTimestamps)}}get(e,t={}){if(this._document){const r=this._document.data.field(qs("DocumentSnapshot.get",e));if(r!==null)return this._userDataWriter.convertValue(r,t.serverTimestamps)}}toJSON(){if(this.metadata.hasPendingWrites)throw new D(S.FAILED_PRECONDITION,"DocumentSnapshot.toJSON() attempted to serialize a document with pending writes. Await waitForPendingWrites() before invoking toJSON().");const e=this._document,t={};return t.type=Ft._jsonSchemaVersion,t.bundle="",t.bundleSource="DocumentSnapshot",t.bundleName=this._key.toString(),!e||!e.isValidDocument()||!e.isFoundDocument()?t:(this._userDataWriter.convertObjectMap(e.data.value.mapValue.fields,"previous"),t.bundle=(this._firestore,this.ref.path,"NOT SUPPORTED"),t)}}Ft._jsonSchemaVersion="firestore/documentSnapshot/1.0",Ft._jsonSchema={type:ie("string",Ft._jsonSchemaVersion),bundleSource:ie("string","DocumentSnapshot"),bundleName:ie("string"),bundle:ie("string")};class es extends Ft{data(e={}){return super.data(e)}}class Ut{constructor(e,t,r,s){this._firestore=e,this._userDataWriter=t,this._snapshot=s,this.metadata=new qn(s.hasPendingWrites,s.fromCache),this.query=r}get docs(){const e=[];return this.forEach(t=>e.push(t)),e}get size(){return this._snapshot.docs.size}get empty(){return this.size===0}forEach(e,t){this._snapshot.docs.forEach(r=>{e.call(t,new es(this._firestore,this._userDataWriter,r.key,r,new qn(this._snapshot.mutatedKeys.has(r.key),this._snapshot.fromCache),this.query.converter))})}docChanges(e={}){const t=!!e.includeMetadataChanges;if(t&&this._snapshot.excludesMetadataChanges)throw new D(S.INVALID_ARGUMENT,"To include metadata changes with your document changes, you must also pass { includeMetadataChanges:true } to onSnapshot().");return this._cachedChanges&&this._cachedChangesIncludeMetadataChanges===t||(this._cachedChanges=function(s,o){if(s._snapshot.oldDocs.isEmpty()){let a=0;return s._snapshot.docChanges.map(u=>{const h=new es(s._firestore,s._userDataWriter,u.doc.key,u.doc,new qn(s._snapshot.mutatedKeys.has(u.doc.key),s._snapshot.fromCache),s.query.converter);return u.doc,{type:"added",doc:h,oldIndex:-1,newIndex:a++}})}{let a=s._snapshot.oldDocs;return s._snapshot.docChanges.filter(u=>o||u.type!==3).map(u=>{const h=new es(s._firestore,s._userDataWriter,u.doc.key,u.doc,new qn(s._snapshot.mutatedKeys.has(u.doc.key),s._snapshot.fromCache),s.query.converter);let d=-1,p=-1;return u.type!==0&&(d=a.indexOf(u.doc.key),a=a.delete(u.doc.key)),u.type!==1&&(a=a.add(u.doc),p=a.indexOf(u.doc.key)),{type:SE(u.type),doc:h,oldIndex:d,newIndex:p}})}}(this,t),this._cachedChangesIncludeMetadataChanges=t),this._cachedChanges}toJSON(){if(this.metadata.hasPendingWrites)throw new D(S.FAILED_PRECONDITION,"QuerySnapshot.toJSON() attempted to serialize a document with pending writes. Await waitForPendingWrites() before invoking toJSON().");const e={};e.type=Ut._jsonSchemaVersion,e.bundleSource="QuerySnapshot",e.bundleName=mo.newId(),this._firestore._databaseId.database,this._firestore._databaseId.projectId;const t=[],r=[],s=[];return this.docs.forEach(o=>{o._document!==null&&(t.push(o._document),r.push(this._userDataWriter.convertObjectMap(o._document.data.value.mapValue.fields,"previous")),s.push(o.ref.path))}),e.bundle=(this._firestore,this.query._query,e.bundleName,"NOT SUPPORTED"),e}}function SE(n){switch(n){case 0:return"added";case 2:case 3:return"modified";case 1:return"removed";default:return x(61501,{type:n})}}/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */function qE(n){n=Pe(n,te);const e=Pe(n.firestore,st);return dE(xs(e),n._key).then(t=>Kh(e,n,t))}Ut._jsonSchemaVersion="firestore/querySnapshot/1.0",Ut._jsonSchema={type:ie("string",Ut._jsonSchemaVersion),bundleSource:ie("string","QuerySnapshot"),bundleName:ie("string"),bundle:ie("string")};class Jo extends RE{constructor(e){super(),this.firestore=e}convertBytes(e){return new Ve(e)}convertReference(e){const t=this.convertDocumentKey(e,this.firestore._databaseId);return new te(this.firestore,null,t)}}function $E(n){n=Pe(n,Ct);const e=Pe(n.firestore,st),t=xs(e),r=new Jo(e);return zh(n._query),fE(t,n._query).then(s=>new Ut(e,r,n,s))}function PE(n,e,t){n=Pe(n,te);const r=Pe(n.firestore,st),s=Wh(n.converter,e,t);return zs(r,[Uh(Bs(r),"setDoc",n._key,s,n.converter!==null,t).toMutation(n._key,ke.none())])}function zE(n,e,t,...r){n=Pe(n,te);const s=Pe(n.firestore,st),o=Bs(s);let a;return a=typeof(e=ce(e))=="string"||e instanceof Fs?IE(o,"updateDoc",n._key,e,t,r):TE(o,"updateDoc",n._key,e),zs(s,[a.toMutation(n._key,ke.exists(!0))])}function HE(n){return zs(Pe(n.firestore,st),[new vo(n._key,ke.none())])}function GE(n,e){const t=Pe(n.firestore,st),r=Lh(n),s=Wh(n.converter,e);return zs(t,[Uh(Bs(n.firestore),"addDoc",r._key,s,n.converter!==null,{}).toMutation(r._key,ke.exists(!1))]).then(()=>r)}function WE(n,...e){n=ce(n);let t={includeMetadataChanges:!1,source:"default"},r=0;typeof e[r]!="object"||wu(e[r])||(t=e[r++]);const s={includeMetadataChanges:t.includeMetadataChanges,source:t.source};if(wu(e[r])){const h=e[r];e[r]=h.next?.bind(h),e[r+1]=h.error?.bind(h),e[r+2]=h.complete?.bind(h)}let o,a,u;if(n instanceof te)a=Pe(n.firestore,st),u=Ps(n._key.path),o={next:h=>{e[r]&&e[r](Kh(a,n,h))},error:e[r+1],complete:e[r+2]};else{const h=Pe(n,Ct);a=Pe(h.firestore,st),u=h._query;const d=new Jo(a);o={next:p=>{e[r]&&e[r](new Ut(a,d,h,p))},error:e[r+1],complete:e[r+2]},zh(n._query)}return function(d,p,y,E){const C=new qo(E),b=new Uo(p,C,y);return d.asyncQueue.enqueueAndForget(async()=>Lo(await _s(d),b)),()=>{C.Nu(),d.asyncQueue.enqueueAndForget(async()=>xo(await _s(d),b))}}(xs(a),u,s,o)}function zs(n,e){return function(r,s){const o=new Ye;return r.asyncQueue.enqueueAndForget(async()=>eE(await hE(r),s,o)),o.promise}(xs(n),e)}function Kh(n,e,t){const r=t.docs.get(e._key),s=new Jo(n);return new Ft(n,s,e._key,r,new qn(t.hasPendingWrites,t.fromCache),e.converter)}function CE(){return new zo("serverTimestamp")}(function(e,t=!0){(function(s){_n=s})(pn),sn(new jt("firestore",(r,{instanceIdentifier:s,options:o})=>{const a=r.getProvider("app").getImmediate(),u=new st(new Tg(r.getProvider("auth-internal")),new wg(a,r.getProvider("app-check-internal")),function(d,p){if(!Object.prototype.hasOwnProperty.apply(d.options,["projectId"]))throw new D(S.INVALID_ARGUMENT,'"projectId" not provided in firebase.initializeApp.');return new tr(d.options.projectId,p)}(a,s),a);return o={useFetchStreams:t,...o},u._setSettings(o),u},"PUBLIC").setMultipleInstances(!0)),_t(Pc,Cc,e),_t(Pc,Cc,"esm2020")})();var bE={};function VE(){if(Nt.PUBLIC_FIREBASE_API_KEY)return{apiKey:Nt.PUBLIC_FIREBASE_API_KEY,authDomain:Nt.PUBLIC_FIREBASE_AUTH_DOMAIN,projectId:Nt.PUBLIC_FIREBASE_PROJECT_ID,appId:Nt.PUBLIC_FIREBASE_APP_ID,messagingSenderId:Nt.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,storageBucket:Nt.PUBLIC_FIREBASE_STORAGE_BUCKET};const n=typeof process<"u"&&bE?.FIREBASE_WEBAPP_CONFIG||"";try{const e=n?JSON.parse(n):{};if(e?.apiKey&&e?.projectId&&e?.appId)return e}catch{}throw new Error("Firebase config not found. Provide PUBLIC_FIREBASE_* envs locally or rely on FIREBASE_WEBAPP_CONFIG in Hosting.")}let $r,zr,Pi;function _r(){return ic().length?$r=ic()[0]:$r=Lu(VE()),zr||(zr=gg($r),im(zr,al).catch(()=>{})),{app:$r,auth:zr}}function Qh(){const{app:n}=_r();return Pi||(Pi=mE(n)),Pi}async function kE(){const{auth:n}=_r();await gl(n,new Qe),await Jh()}async function DE(){const{auth:n}=_r(),e=new Hn("apple.com");e.addScope("email"),e.addScope("name"),await gl(n,e),await Jh()}async function Jh(){const{auth:n}=_r(),e=n.currentUser;e&&await Xh(e.uid,{email:e.email,name:e.displayName,photoURL:e.photoURL})}function NE(n){return Lh(Qh(),"users",n)}async function Xh(n,e){await PE(NE(n),{createdAt:CE(),email:e?.email??null,name:e?.name??null,photoURL:e?.photoURL??null,settings:{theme:"dark",notifications:!0}},{merge:!0})}const KE=Object.freeze(Object.defineProperty({__proto__:null,ensureUserDoc:Xh,getDb:Qh,getFirebase:_r,signInWithApple:DE,signInWithGoogle:kE},Symbol.toStringTag,{value:"Module"}));export{qE as a,jE as b,FE as c,Lh as d,zE as e,HE as f,Qh as g,$E as h,CE as i,_r as j,mE as k,GE as l,kE as m,DE as n,WE as o,LE as p,UE as q,KE as r,PE as s,ME as u,BE as w};
