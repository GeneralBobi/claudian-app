'use strict';
const {WebContentsView,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path');
const allowed=value=>{try{const u=new URL(value);return u.origin==='https://claudian.app'&&!u.username&&!u.password;}catch{return false;}};
exports.allowed=allowed;
exports.attach=(win,handle)=>{
 let panel=null,visible=false,bounds=null,loaded=false,failedResponse=false;
 const send=(state)=>{if(!win.isDestroyed())win.webContents.send('companion:state',state);};
 const layout=()=>{if(!panel||!bounds)return;const [w,h]=win.getContentSize();const y=Math.max(0,Math.min(h-40,Math.round(bounds.y)));panel.setBounds({x:16,y,width:Math.max(1,w-32),height:Math.max(1,h-y-16)});};
 async function ensure(){
  if(panel)return;
  const partition=session.fromPartition('persist:claudian-companion');
  partition.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));
  partition.setPermissionCheckHandler(()=>false);
  panel=new WebContentsView({webPreferences:{session:partition,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  panel.setBackgroundColor('#0e0e10');win.contentView.addChildView(panel);panel.setVisible(false);
  const wc=panel.webContents;
  wc.setWindowOpenHandler(()=>({action:'deny'}));
  wc.on('will-navigate',(e,url)=>{if(!allowed(url))e.preventDefault();});
  wc.on('will-redirect',(e,url)=>{if(!allowed(url))e.preventDefault();});
  wc.on('did-start-loading',()=>{failedResponse=false;send({status:'loading'});});
  wc.on('did-navigate',(_event,_url,status)=>{if(status>=400){failedResponse=true;loaded=false;panel.setVisible(false);send({status:'offline'});}});
  wc.on('did-fail-load',(_e,code,_description,_url,main)=>{if(main&&code!==-3){panel.setVisible(false);loaded=false;send({status:'offline'});}});
  wc.on('did-finish-load',async()=>{
   if(!allowed(wc.getURL())||failedResponse)return;
   loaded=true;
   await wc.insertCSS(await fs.readFile(path.join(__dirname,'ui/companion.css'),'utf8')).catch(()=>{});
   if(visible)panel.setVisible(true);
   send({status:'ready'});
  });
 }
 handle('companion:show',async rect=>{if(!rect||!Number.isFinite(rect.y))throw Error('Invalid panel bounds.');bounds={y:rect.y};visible=true;await ensure();layout();if(loaded)panel.setVisible(true);else {send({status:'loading'});panel.webContents.loadURL('https://claudian.app/giris?next=%2F').catch(()=>send({status:'offline'}));}return true;});
 handle('companion:hide',()=>{visible=false;panel?.setVisible(false);});
 handle('companion:resize',rect=>{if(rect&&Number.isFinite(rect.y)){bounds={y:rect.y};layout();}});
 handle('companion:reload',async()=>{await ensure();panel.setVisible(false);loaded=false;await panel.webContents.loadURL('https://claudian.app/giris?next=%2F').catch(()=>send({status:'offline'}));});
 handle('companion:logout',async()=>{await ensure();await panel.webContents.session.clearStorageData();await panel.webContents.session.clearCache();loaded=false;panel.setVisible(false);send({status:'loading'});await panel.webContents.loadURL('https://claudian.app/giris?next=%2F').catch(()=>send({status:'offline'}));});
 win.on('resize',layout);
 win.on('closed',()=>{if(panel&&!panel.webContents.isDestroyed())panel.webContents.close();panel=null;});
};
