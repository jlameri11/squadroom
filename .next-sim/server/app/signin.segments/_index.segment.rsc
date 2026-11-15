1:"/_next/static/chunks/11c4jd1owx4o5.js"
2:"/_next/static/chunks/0gy0h840pwb22.js"
3:"/_next/static/chunks/35s64pxgur06o.js"
4:"/_next/static/chunks/340u9dqtdtx73.js"
5:"LoadingBoundaryProvider"
6:I[39756,["$1","$2","$3","$4"],"$5"]
7:"$Sreact.fragment"
:HL["/_next/static/chunks/01robp59dnfj3.css","style"]
8:T4ff,(function(){try{
var d=document.documentElement,ls=window.localStorage;
var a=null;try{a=JSON.parse(ls.getItem("squadroom.appearance")||'null')}catch(e){}
var mode=(a&&a.mode)||ls.getItem("squadroom.theme")||'system';
if(mode==='light'||mode==='dark')d.dataset.theme=mode;
var design=(a&&a.design==='mono')?'mono':'club';
d.dataset.design=design;
var p=location.pathname,bare=["/signin","/signup","/start","/auth","/join","/join-competition","/my","/c","/for-clubs","/privacy","/status","/clubs","/terms"],roots=["admin","api","auth","c","calendar","card","chat","clubs","competitions","directory","for-clubs","join","join-competition","my","offer","payments","platform","privacy","programs","ref","referee","scan","settings","signin","signup","start","status","terms"],sq=["platform"];
var pub=bare.some(function(b){return p===b||p.indexOf(b+'/')===0});
var seg=p.split('/').filter(Boolean);
if(!pub&&seg.length&&roots.indexOf(seg[0])<0)pub=seg.length===1||(seg.length===2&&seg[1]==='register');
var app=!pub&&sq.indexOf(seg[0]||'')<0;
if(design==='club'&&app){var c=JSON.parse(ls.getItem("squadroom.club")||'null');
if(c&&c.css&&c.id){var s=document.createElement('style');s.id='club-theme';s.textContent=c.css;document.head.appendChild(s);d.dataset.club=c.id}}
}catch(e){}})()d:X
0:{"t":{"t":{"s":"","h":20,"d":{"r":["$","$L6",null,{"loading":[["$","div","l",{"className":"mx-auto flex min-h-dvh w-full max-w-md flex-col","data-skeleton":true,"children":[["$","div",null,{"className":"flex items-center gap-3 px-4 pb-3.5 pt-3","style":{"background":"var(--bar)"},"children":[["$","div",null,{"className":"h-9 w-9 flex-none rounded-[10px]","style":{"background":"color-mix(in srgb, var(--bar-ink) 16%, transparent)"}}],["$","div",null,{"className":"min-w-0 flex-1","children":[["$","div",null,{"className":"h-4 w-32 rounded","style":{"background":"color-mix(in srgb, var(--bar-ink) 18%, transparent)"}}],["$","div",null,{"className":"mt-1.5 h-2.5 w-24 rounded","style":{"background":"color-mix(in srgb, var(--bar-ink) 10%, transparent)"}}]]}]]}],["$","div",null,{"className":"flex-1 px-3.5 pt-4","children":[["$","div",null,{"className":"mb-2 h-3 w-28 rounded bg-[var(--surface-2)]"}],["$","div",null,{"className":"stack","children":[["$","div","0",{"className":"card ev animate-pulse","style":{"animationDelay":"0ms"},"children":["$","div",null,{"className":"ev-top","children":[["$","div",null,{"className":"datechip","children":[["$","div",null,{"className":"mx-auto h-5 w-6 rounded bg-[var(--surface-2)]"}],["$","div",null,{"className":"mx-auto mt-1 h-2 w-6 rounded bg-[var(--surface-2)]"}]]}],["$","div",null,{"className":"min-w-0 flex-1","children":[["$","div",null,{"className":"h-3.5 w-16 rounded bg-[var(--surface-2)]"}],["$","div",null,{"className":"mt-2 h-3.5 w-full rounded bg-[var(--surface-2)]"}],["$","div",null,{"className":"mt-1.5 h-3 w-2/3 rounded bg-[var(--surface-2)]"}]]}]]}]}],["$","div","1",{"className":"card ev animate-pulse","style":{"animationDelay":"90ms"},"children":["$","div",null,{"className":"ev-top","children":[["$","div",null,{"className":"datechip","children":[["$","div",null,{"className":"mx-auto h-5 w-6 rounded bg-[var(--surface-2)]"}],["$","div",null,{"className":"mx-auto mt-1 h-2 w-6 rounded bg-[var(--surface-2)]"}]]}],["$","div",null,{"className":"min-w-0 flex-1","children":[["$","div",null,{"className":"h-3.5 w-16 rounded bg-[var(--surface-2)]"}],["$","div",null,{"className":"mt-2 h-3.5 w-full rounded bg-[var(--surface-2)]"}],["$","div",null,{"className":"mt-1.5 h-3 w-2/3 rounded bg-[var(--surface-2)]"}]]}]]}]}],["$","div","2",{"className":"card ev animate-pulse","style":{"animationDelay":"180ms"},"children":["$","div",null,{"className":"ev-top","children":[["$","div",null,{"className":"datechip","children":[["$","div",null,{"className":"mx-auto h-5 w-6 rounded bg-[var(--surface-2)]"}],["$","div",null,{"className":"mx-auto mt-1 h-2 w-6 rounded bg-[var(--surface-2)]"}]]}],["$","div",null,{"className":"min-w-0 flex-1","children":[["$","div",null,{"className":"h-3.5 w-16 rounded bg-[var(--surface-2)]"}],["$","div",null,{"className":"mt-2 h-3.5 w-full rounded bg-[var(--surface-2)]"}],["$","div",null,{"className":"mt-1.5 h-3 w-2/3 rounded bg-[var(--surface-2)]"}]]}]]}]}]]}]]}]]}],[],null],"children":["$","$7","c",{"children":[[["$","link","0",{"rel":"stylesheet","href":"/_next/static/chunks/01robp59dnfj3.css","precedence":"next"}],["$","script","script-0",{"src":"/_next/static/chunks/11c4jd1owx4o5.js","async":true}],["$","script","script-1",{"src":"/_next/static/chunks/0gy0h840pwb22.js","async":true}],["$","script","script-2",{"src":"/_next/static/chunks/35s64pxgur06o.js","async":true}],["$","script","script-3",{"src":"/_next/static/chunks/340u9dqtdtx73.js","async":true}]],["$","html",null,{"lang":"en-AU","className":"xey8Gq_variable BwbXua_variable h-full","suppressHydrationWarning":true,"children":[["$","head",null,{"children":[["$","script",null,{"dangerouslySetInnerHTML":{"__html":"$8"}}],"$L9","$La"]}],"$Lb"]}]]}]}],"p":"$@c","v":null,"s":"$d"}}},"a":"$@e","u":"$@f","b":"oHFXKmzMdfagGKxY730cT"}
10:I[91932,["$1","$2","$3","$4"],"HashSession"]
11:I[25796,["$1","$2","$3","$4"],"ThemeController"]
12:I[40775,["$1","$2","$3","$4"],"TwoStepGate"]
13:I[41971,["$1","$2","$3","$4"],"TwoStepWall"]
14:I[50649,["$1","$2","$3","$4"],"EmailGate"]
15:I[6676,["$1","$2","$3","$4"],"PasswordGate"]
16:I[39756,["$1","$2","$3","$4"],"default"]
17:I[37457,["$1","$2","$3","$4"],"default"]
18:I[55754,["$1","$2","$3","$4"],"OfflineBanner"]
19:I[48026,["$1","$2","$3","$4"],"TabBar"]
9:["$","script",null,{"dangerouslySetInnerHTML":{"__html":"(function(){try{\nif(!(window.CSS&&CSS.supports&&CSS.supports('-webkit-touch-callout','none')))return;\nvar d=document.documentElement;\nfunction fit(){\nvar p=document.createElement('span');\np.setAttribute('data-text-probe','');\np.style.cssText='font:-apple-system-body;position:absolute;visibility:hidden';\nd.appendChild(p);\nvar px=parseFloat(getComputedStyle(p).fontSize);\nd.removeChild(p);\nif(!(px>0))return;\nvar r=Math.min(32,Math.max(16,16*px/17));\nif(r===16)d.style.removeProperty('font-size');\nelse d.style.fontSize=(Math.round(r*100)/100)+'px';\n}\nfit();\ndocument.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')fit()});\n}catch(e){}})()"}}]
a:["$","link",null,{"rel":"preconnect","href":"http://localhost:54330","crossOrigin":"anonymous"}]
b:["$","body",null,{"className":"min-h-full flex flex-col bg-paper text-ink","children":[["$","$L10",null,{}],["$","$L11",null,{}],["$","$L12",null,{}],["$","$L13",null,{}],["$","$L14",null,{}],["$","$L15",null,{}],["$","div",null,{"className":"flex min-h-dvh flex-col","children":[["$","div",null,{"className":"flex-1","children":["$","$L16",null,{"parallelRouterKey":"children","template":["$","$L17",null,{}],"notFound":[[["$","title",null,{"children":"404: This page could not be found."}],["$","div",null,{"style":{"fontFamily":"system-ui,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif,\"Apple Color Emoji\",\"Segoe UI Emoji\"","height":"100vh","textAlign":"center","display":"flex","flexDirection":"column","alignItems":"center","justifyContent":"center"},"children":["$","div",null,{"children":[["$","style",null,{"dangerouslySetInnerHTML":{"__html":"body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}"}}],["$","h1",null,{"className":"next-error-h1","style":{"display":"inline-block","margin":"0 20px 0 0","padding":"0 23px 0 0","fontSize":24,"fontWeight":500,"verticalAlign":"top","lineHeight":"49px"},"children":404}],["$","div",null,{"style":{"display":"inline-block"},"children":["$","h2",null,{"style":{"fontSize":14,"fontWeight":400,"lineHeight":"49px","margin":0},"children":"This page could not be found."}]}]]}]}]],[]]}]}],["$","div",null,{"className":"sticky bottom-0 z-20","children":[["$","$L18",null,{}],["$","$L19",null,{}]]}]]}]]}]
d:300
f:true
d:C
e:0
c:"$undefined"
