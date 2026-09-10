'use strict';
const {execFile,spawn}=require('node:child_process');
const run=require('node:util').promisify(execFile);
const fs=require('node:fs/promises');
const path=require('node:path');
const commands={'codex':'codex','claude-code':'claude'};
exports.resolve=async id=>{
 if(!commands[id])return null;
 try {const {stdout}=await run('where.exe',[commands[id]],{windowsHide:true});return stdout.split(/\r?\n/).map(x=>x.trim()).find(x=>path.isAbsolute(x)&&/\.exe$/i.test(x))||null;}catch{return null;}
};
exports.prompt=profile=>`Use the installed claudian-memory skill for the selected vault: ${JSON.stringify(profile.vault)}.
Read Claudian Home.md, Claudian Universal Protocol.md and Claudian Record Guide.md before working.

I want an initial, careful review of what you already know about me. Use only memories actually available to this session and connected sources I have authorized. First tell me briefly which sources you can access; if a source needs permission or its scope is unclear, ask before reading it. Do not scan unrelated computer files, invent access to earlier chats, or treat this request as access to other providers' accounts. If nothing useful is available, ask up to three focused questions and wait for my answers.

Look for durable goals, active projects, accepted decisions and their reasons, stable preferences, corrections and lessons that would improve future conversations. Search existing notes first. Distinguish my statements from observations and tentative interpretations. Do not infer sensitive traits or copy secrets, private third-party records, entire chats or temporary moods. Follow the protocol's admission and context rules; deeper review means better selection, not more notes.

Keep one canonical record per topic. Apply ADD, UPDATE, INVALIDATE, DELETE or NO_OP as appropriate, preserving source, known dates and uncertainty. Repair useful links to the home map and related notes. Do not delete unrelated notes. Verify your edits and give a brief completion summary of actual sources used, records updated and any gaps. Do not claim completion before writing.

If this host offers persistent memory, remember only this usage pointer there: use claudian-memory silently at conversation start for relevant context, maintain this selected vault according to its protocol, and do not wait for a slash command. Do not duplicate the whole vault into provider memory. If persistent memory is unavailable, say so; the installed startup instructions remain the entry mechanism.

After this initial review, keep routine memory maintenance quiet. This is a user-started session, not an always-running background agent.
Respond in ${profile.language==='tr'?'Turkish':'English'}.`;
exports.launch=async(profile,id,prompt,dataDir)=>{
 if(!profile.hosts.some(h=>h.id===id))throw new Error('This AI connection is not configured.');
 if(typeof prompt!=='string'||!prompt.trim()||prompt.length>8000)throw new Error('Invalid scan message.');
 const executable=await exports.resolve(id);if(!executable)throw new Error('An interactive native Claude Code or Codex CLI executable is required.');
 const quote=s=>"'"+s.replace(/'/g,"''")+"'";
 const script=`Set-Location -LiteralPath ${quote(profile.vault)}\n& ${quote(executable)} ${quote(prompt)}\n`;
 // No shell interpolation of user text; PowerShell literals double embedded quotes.
 const child=spawn('powershell.exe',['-NoProfile','-NoExit','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{detached:true,stdio:'ignore',windowsHide:false});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
 return {launched:true};
};
