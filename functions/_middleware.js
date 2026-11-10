import { authorize } from "./_lib/authz.js";
import { canUseReport } from "./_lib/registry.js";

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
}
function denied() {
  return new Response("<!doctype html><html lang='en'><meta charset='utf-8'><title>Access denied</title><body style='font-family:Arial;text-align:center;padding:60px'><h1>Access denied</h1><p>Your account is not authorized for SKU Intelligence.</p><p>Ask an administrator to add <b>SKU Intelligence</b> to your Report Access.</p></body></html>", {status:403,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
}
function setupError(error) {
  return new Response(`<!doctype html><html lang='en'><meta charset='utf-8'><title>Access setup error</title><body style='font-family:Arial;padding:50px'><h1>Access setup error</h1><pre>${escapeHtml(error?.message || "Unknown error")}</pre></body></html>`, {status:500,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
}
function signInResponse(message = "Sign in with your authorized Google account to view SKU Intelligence.") {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SKU Intelligence Sign In</title><script src="https://accounts.google.com/gsi/client" async defer></script><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Arial,sans-serif;background:#f4f5f7;color:#111}main{width:min(440px,calc(100vw - 32px));background:#fff;border:1px solid #ddd;border-radius:16px;padding:34px;box-shadow:0 18px 50px #0001;text-align:center}h1{margin:0 0 10px;font-size:28px}p{color:#666;line-height:1.5}#status{margin-top:16px;font-size:13px;color:#a33;min-height:18px}</style></head><body><main><h1>SKU Intelligence</h1><p>${escapeHtml(message)}</p><div id="googleBtn"></div><div id="status"></div><script>const statusEl=document.getElementById("status");async function init(){try{const r=await fetch("/api/config",{cache:"no-store"});const c=await r.json();if(!r.ok||!c.googleClientId)throw new Error(c.error||"Google sign-in is not configured");google.accounts.id.initialize({client_id:c.googleClientId,callback:async({credential})=>{try{statusEl.textContent="Signing in...";const x=await fetch("/api/login",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({credential})});const d=await x.json().catch(()=>({}));if(!x.ok)throw new Error(d.error||"Sign-in failed");location.reload()}catch(e){statusEl.textContent=e.message||"Sign-in failed"}}});google.accounts.id.renderButton(document.getElementById("googleBtn"),{theme:"outline",size:"large",width:300})}catch(e){statusEl.textContent=e.message||"Unable to initialize sign-in"}}window.onload=init;</script></main></body></html>`, {status:401,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
}
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const protectedPath = url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/data" || url.pathname.startsWith("/data/");
  if (!protectedPath) return context.next();
  try {
    const { user } = await authorize(context);
    if (!canUseReport(user, "sku_intelligence")) return denied();
    const response = await context.next();
    const headers = new Headers(response.headers);
    headers.set("cache-control", "private, no-store, max-age=0");
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  } catch (e) {
    if (["session_missing","session_expired","session_invalid"].includes(e?.code)) return signInResponse(e.code === "session_expired" ? "Your session expired. Please sign in again." : undefined);
    if (e?.status === 403) return denied();
    return setupError(e);
  }
}
