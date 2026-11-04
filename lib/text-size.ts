/**
 * The phone's text size (X-10, Dynamic Type).
 *
 * Every text size in the product is in rem, so the root font size decides
 * all of them, and the stylesheet never sets one on `html` or `:root`.
 *
 * ANDROID. Chrome 146+ sets the root from the phone's text-size setting
 * itself, once a page opts in with `<meta name="text-scale" content="scale">`
 * (the root layout's metadata). Chrome's own guidance is to set no root font
 * size at all — not even a clamp — so nothing here touches it there.
 *
 * iPHONE. Safari has no such switch. What it has is the system font keyword
 * `-apple-system-body`, which follows Dynamic Type: 17px at the default
 * setting, 53px at the largest accessibility size. The script below reads
 * the keyword's size and sets the root to the same proportion of 16px, so an
 * iPhone at the default setting looks exactly as designed and one set larger
 * gets larger text everywhere, spacing included.
 *
 * Between 16px and 32px:
 *   - never smaller than designed. Apple's own captions do not shrink at the
 *     smaller settings, and the product's smallest labels (10–12px) already
 *     are captions;
 *   - never past 200%, which is what WCAG 1.4.4 asks a page to survive and
 *     what test-a11y proves on 21 screens. Past it, pinch zoom still works
 *     (the viewport does not lock scale).
 *
 * Only where `-webkit-touch-callout` is supported, which is iOS and iPadOS
 * WebKit — Safari, the home-screen app and the native shell's WKWebView —
 * and nothing else: on a Mac `-apple-system-body` is 13px and would shrink
 * every screen. Measured again when the app comes back to the front,
 * because the setting is changed in another app.
 *
 * Runs in <head> before the first paint, like the theme script, so a larger
 * setting never shows one frame at the small size. Setting the root's style
 * before React hydrates is covered by `suppressHydrationWarning` on <html>.
 */
export const IOS_DEFAULT_BODY_PX = 17
export const ROOT_MIN_PX = 16
export const ROOT_MAX_PX = 32

export const TEXT_SIZE_SCRIPT = `(function(){try{
if(!(window.CSS&&CSS.supports&&CSS.supports('-webkit-touch-callout','none')))return;
var d=document.documentElement;
function fit(){
var p=document.createElement('span');
p.setAttribute('data-text-probe','');
p.style.cssText='font:-apple-system-body;position:absolute;visibility:hidden';
d.appendChild(p);
var px=parseFloat(getComputedStyle(p).fontSize);
d.removeChild(p);
if(!(px>0))return;
var r=Math.min(${ROOT_MAX_PX},Math.max(${ROOT_MIN_PX},${ROOT_MIN_PX}*px/${IOS_DEFAULT_BODY_PX}));
if(r===${ROOT_MIN_PX})d.style.removeProperty('font-size');
else d.style.fontSize=(Math.round(r*100)/100)+'px';
}
fit();
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')fit()});
}catch(e){}})()`
