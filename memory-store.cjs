'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const MAX_BYTES = 512 * 1024;
const excluded = name => name.startsWith('.') || ['node_modules', '_to_delete', '_arsiv'].includes(name);

function inside(vault, name) {
  if (typeof name !== 'string' || !name.trim() || /[\x00-\x1f:]/.test(name) || path.isAbsolute(name)) throw Error('That name is not a valid file name.');
  const parts = name.replace(/\\/g, '/').split('/');
  if (parts.some(p => !p || p === '..' || p === '.' || excluded(p))) throw Error('That path is outside the notes folder or protected.');
  const target = path.resolve(vault, name.endsWith('.md') ? name : name + '.md');
  const relative = path.relative(path.resolve(vault), target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('That path is outside the notes folder.');
  return target;
}

async function ordinary(target) {
  let cursor = path.resolve(target);
  for (;;) {
    try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw Error('Symbolic links and junctions are not allowed in memory paths.'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const parent = path.dirname(cursor); if (parent === cursor) return; cursor = parent;
  }
}

async function read(vault, name) {
  const target = inside(vault, name); await ordinary(target);
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('Note is not a regular file or exceeds the 512 KiB limit.');
  const body = await fs.readFile(target, 'utf8');
  return { note: path.relative(vault, target).split(path.sep).join('/'), body, sha256: digest(body) };
}

async function list(vault) {
  await ordinary(vault);
  const result = [];
  async function walk(dir, depth) {
    if (depth > 16) throw Error('Note tree exceeds the supported depth; narrow the memory folder.');
    for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
      if (excluded(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.includes('(yours ')) {
        const stat = await fs.stat(file);
        result.push({note: path.relative(vault, file).split(path.sep).join('/'), modifiedAt: stat.mtime.toISOString(), bytes: stat.size});
        if (result.length > 10000) throw Error('Note tree exceeds 10000 files; narrow the memory folder.');
      }
    }
  }
  await walk(vault, 0); return result.sort((a,b) => a.note.localeCompare(b.note));
}

async function search(vault, query, limit = 40) {
  if (typeof query !== 'string' || !query.trim()) throw Error('A search term is required.');
  limit = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 40));
  const needle = query.toLocaleLowerCase('tr'), hits = [];
  for (const item of await list(vault)) {
    if (item.bytes > MAX_BYTES) continue;
    const {body} = await read(vault, item.note);
    const lines = body.split(/\r?\n/);
    if (item.note.toLocaleLowerCase('tr').includes(needle)) hits.push({note:item.note, line:0, text:'Filename match'});
    for (let i=0; i<lines.length && hits.length<limit; i++) if (lines[i].toLocaleLowerCase('tr').includes(needle)) hits.push({note:item.note,line:i+1,text:lines[i].slice(0,500)});
    if (hits.length >= limit) break;
  }
  return hits.slice(0,limit);
}

async function audit(vault, receipt) {
  const dir = path.join(vault, '.claudian', 'receipts'); await ordinary(dir); await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir, receipt.id + '.json'), JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
}

async function history(vault, limit = 30) {
  const dir=path.join(vault,'.claudian','receipts'); await ordinary(dir);
  let names; try { names=await fs.readdir(dir); } catch(e) { if(e.code==='ENOENT')return []; throw e; }
  const rows=[];
  for(const name of names.filter(n=>/^[a-zA-Z0-9_-]+\.json$/.test(n))) {
    try { rows.push(JSON.parse(await fs.readFile(path.join(dir,name),'utf8'))); } catch {}
  }
  return rows.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,limit);
}

async function mutate(vault, args, actor = 'unknown') {
  const {note, operation, expected_sha256, reason} = args;
  if (!['create','patch','append','archive'].includes(operation)) throw Error('Unknown memory operation.');
  if (typeof reason !== 'string' || !reason.trim() || reason.length>500) throw Error('A short factual reason is required.');
  const target = inside(vault,note); await ordinary(target);
  if (['Claudian Universal Protocol.md','Vault Protocol.md','Claudian Memory Protocol.md'].includes(path.basename(target))) throw Error('The application manages this protocol. Change user preferences in working agreements instead.');
  const lockDir=path.join(vault,'.claudian','locks'); await ordinary(lockDir); await fs.mkdir(lockDir,{recursive:true});
  const lockPath=path.join(lockDir,digest(target)+'.lock');
  let lock; try { lock=await fs.open(lockPath,'wx'); } catch(e) { if(e.code==='EEXIST')throw Error('Another memory write is active or interrupted. Review the lock before retrying.'); throw e; }
  const id=crypto.randomUUID(); let temp;
  try {
    let before=null;
    try { before=(await read(vault,note)).body; } catch(e) { if(e.code!=='ENOENT')throw e; }
    if(operation==='create' && before!==null) throw Error('Note already exists. Read it and use patch_note.');
    if(operation!=='create' && (before===null || !/^[a-f0-9]{64}$/.test(expected_sha256||'') || digest(before)!==expected_sha256)) throw Error('Note changed or current SHA-256 is missing. Read it again before editing.');
    let after;
    if(operation==='patch') {
      if(typeof args.old_text!=='string'||!args.old_text||typeof args.new_text!=='string')throw Error('An exact old_text and new_text are required.');
      const parts=before.split(args.old_text); if(parts.length!==2)throw Error('old_text must match exactly once. Read a more specific passage.');
      after=parts.join(args.new_text);
    } else if(operation==='append') {
      if(typeof args.body!=='string'||!args.body.trim())throw Error('Nothing to append.');
      after=before+(before&&!before.endsWith('\n')?'\n':'')+args.body;
    } else if(operation==='create') {
      if(typeof args.body!=='string'||!args.body.trim())throw Error('A note body is required.'); after=args.body;
    }
    if(after!==undefined) { if(!after.endsWith('\n'))after+='\n'; if(Buffer.byteLength(after)>MAX_BYTES)throw Error('Note exceeds the 512 KiB limit.'); }
    let backup=null;
    if(before!==null) {
      const dir=path.join(vault,'.claudian','backups');await ordinary(dir);await fs.mkdir(dir,{recursive:true});
      backup=path.join(dir,id+'.md');await fs.writeFile(backup,before,{flag:'wx'});
    }
    const receipt={id,at:new Date().toISOString(),actor,operation,note:path.relative(vault,target).split(path.sep).join('/'),reason,
      beforeSha256:before===null?null:digest(before),afterSha256:after===undefined?null:digest(after),backup:backup?path.relative(vault,backup):null,status:'prepared'};
    // Persist intent before touching the note. An interrupted write remains visible.
    await audit(vault,receipt);
    await ordinary(target);
    const current=await fs.readFile(target,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(current!==before)throw Error('Note changed while preparing the write. No replacement was made.');
    if(operation==='archive') {
      const archiveDir=path.join(vault,'.claudian','archive'); await ordinary(archiveDir);await fs.mkdir(archiveDir,{recursive:true});
      const archived=path.join(archiveDir,id+'.md'); await fs.rename(target,archived);receipt.archived=path.relative(vault,archived);
    } else if(operation==='create') {
      await fs.mkdir(path.dirname(target),{recursive:true}); await ordinary(target); await fs.writeFile(target,after,{flag:'wx'});
    } else {
      temp=target+'.'+id+'.tmp';await fs.writeFile(temp,after,{flag:'wx'});
      if(await fs.readFile(target,'utf8')!==before)throw Error('Note changed before commit. Read again.');
      await fs.rename(temp,target);temp=null;
    }
    if(operation!=='archive' && digest(await fs.readFile(target,'utf8'))!==receipt.afterSha256)throw Error('Write verification failed. Inspect the receipt and backup.');
    receipt.status='committed';
    await fs.writeFile(path.join(vault,'.claudian','receipts',id+'.json'),JSON.stringify(receipt,null,2)+'\n');
    return receipt;
  } finally { if(temp)await fs.unlink(temp).catch(()=>{}); await lock.close(); await fs.unlink(lockPath); }
}

module.exports={inside,ordinary,read,list,search,mutate,history,digest};
