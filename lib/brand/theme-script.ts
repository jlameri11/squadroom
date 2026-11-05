/**
 * The first frame, in the right clothes (runs in <head>, before paint).
 *
 * Light or dark from the person's Appearance, and their club's colours on the
 * app's own screens — read from what the browser cached the last time
 * (lib/brand/appearance.ts). Without this a parent whose club is green would
 * see a black bar for a frame on every open and then watch it turn green.
 *
 * The page rule is lib/routes.ts's, written into the script as data, so the
 * script and the app cannot disagree about which pages wear a club's
 * colours. Everything here is wrapped: a broken localStorage leaves the page
 * in Squadroom's black and white, which is always correct.
 */
import { APP_ROOTS, BARE, SQUADROOM_ROOTS } from '@/lib/routes'
import { APPEARANCE_KEY, CLUB_KEY, LEGACY_THEME_KEY } from '@/lib/brand/keys'

export const THEME_SCRIPT = `(function(){try{
var d=document.documentElement,ls=window.localStorage;
var a=null;try{a=JSON.parse(ls.getItem(${JSON.stringify(APPEARANCE_KEY)})||'null')}catch(e){}
var mode=(a&&a.mode)||ls.getItem(${JSON.stringify(LEGACY_THEME_KEY)})||'system';
if(mode==='light'||mode==='dark')d.dataset.theme=mode;
var design=(a&&a.design==='mono')?'mono':'club';
d.dataset.design=design;
var p=location.pathname,bare=${JSON.stringify(BARE)},roots=${JSON.stringify([...APP_ROOTS])},sq=${JSON.stringify(SQUADROOM_ROOTS)};
var pub=bare.some(function(b){return p===b||p.indexOf(b+'/')===0});
var seg=p.split('/').filter(Boolean);
if(!pub&&seg.length&&roots.indexOf(seg[0])<0)pub=seg.length===1||(seg.length===2&&seg[1]==='register');
var app=!pub&&sq.indexOf(seg[0]||'')<0;
if(design==='club'&&app){var c=JSON.parse(ls.getItem(${JSON.stringify(CLUB_KEY)})||'null');
if(c&&c.css&&c.id){var s=document.createElement('style');s.id='club-theme';s.textContent=c.css;document.head.appendChild(s);d.dataset.club=c.id}}
}catch(e){}})()`
