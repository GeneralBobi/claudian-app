'use strict';
const webOnly=host=>['chatgpt','gemini','perplexity'].includes(host);
// Authorization is not installation. Evidence belongs to one grant; do not
// combine an old connector's tools with a new connector's permission.
function progress(status,host){
 const grants=(status.grants||[]).filter(g=>g.host===host&&!g.revoked);
 const ready=grants.find(g=>g.toolsReadyAt);
 const phase=!status.enabled?'device':status.state!=='online'?'offline':ready?'tools':grants.some(g=>g.tokenExchangedAt)?'loading':grants.length?'authorizing':'setup';
 return {phase,canTest:phase==='tools'&&ready.scope?.split(' ').includes('claudian.write'),grantId:ready?.id};
}
module.exports={webOnly,progress};
