'use strict';
// Native read-only projection of the existing Core. No embedded website or model calls.
exports.attach=(handle,session)=>{
 const transport=session.fromPartition('persist:claudian-native-core');
 const request=async(endpoint,options={})=>{
  const response=await transport.fetch('https://claudian.app'+endpoint,{...options,credentials:'include',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','Origin':'https://claudian.app',...options.headers}});
  if(!response.ok)throw Error(response.status===401?'CORE_AUTH_REQUIRED':response.status===429?'CORE_RATE_LIMIT':'CORE_UNAVAILABLE');
  if(!response.headers.get('content-type')?.includes('application/json'))throw Error('CORE_UNAVAILABLE');
  return response.json();
 };
 handle('companion:connect',async code=>{
  if(typeof code!=='string'||code.length>128||!code.trim())throw Error('CORE_AUTH_REQUIRED');
  await request('/api/auth/login',{method:'POST',body:JSON.stringify({code})});
  return request('/api/surface');
 });
 handle('companion:refresh',()=>request('/api/surface'));
 handle('companion:disconnect',async()=>{await transport.clearStorageData();return true;});
};
