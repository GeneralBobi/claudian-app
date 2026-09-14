'use strict';
// Web applications have independent identities. Never migrate CLI receipts to them.
const providers={
 gemini:{label:'Gemini',chat:'https://gemini.google.com/app',setup:'https://gemini.google.com/spark/apps',
  steps:'Connected Apps → Custom apps for Spark → Add a custom app. Paste the MCP server URL and choose Next. Claudian supports Dynamic Client Registration; do not invent client credentials.',
  requirements:'Google currently limits custom Spark apps to eligible personal accounts, age 18+, in the US, in English, with Keep Activity on and Spark access. If Custom apps is missing, stop: ordinary Gemini chat cannot access a local Windows vault.'},
 perplexity:{label:'Perplexity',chat:'https://www.perplexity.ai/',setup:'https://www.perplexity.ai/account/connectors',
  steps:'Choose + Custom connector → Remote. Name: Claudian. Paste the MCP server URL. Authentication: OAuth. Transport: Streamable HTTP. Add, then open the connector to connect. Keep it private to your account.',
  requirements:'Custom connectors must be available for your account; an organization administrator may need to enable them. If the option is missing, report that limitation instead of claiming installation.'}
};
const isWeb=id=>Object.hasOwn(providers,id);
function guide(id,endpoint){
 const p=providers[id];if(!p)throw Error('Unknown web provider');
 return `Help me set up Claudian in ${p.label} web. ${p.requirements}\n${p.steps}\nMCP server URL: ${endpoint}\nAuthentication: OAuth. Keep Claudian and this computer running. Preserve existing connectors and notes; reuse a matching URL. Guide me one visible step at a time. If you have no browser tools, do not claim to operate settings. Never ask for passwords, tokens or API keys in chat. Compare the authorization code with Claudian before approving the requested access. After connecting, use the Claudian connection test with read_connection_test and submit_connection_test. Do not use another application or local file fallback. A saved connector alone does not prove access. Do not ask personal onboarding questions.`;
}
function geminiGuide(language='en'){
 if(language==='tr')return 'Gemini web içinde Claudian kullanmama Türkçe, bir seferde bir adımla yardım et. Önce bu sohbetin gerçekten erişebildiği araçlara bak. Claudian araçları varsa startup_context çağır. Yoksa yerel Windows dosyalarıma eriştiğini veya kalıcı hafıza kurduğunu söyleme. Canlı bağlantı için Spark özel uygulamalarını kullanmamız gerekir; hesabımda bu seçenek yoksa burada dur. Gemini CLI veya Antigravity’ye yönlendirme. Canlı bağlantı olmadan yalnızca seçerek paylaştığım içerikle çalış; not değişikliklerini benim kaydetmem için öner. Tüm hafıza klasörümü isteme, kişisel profil soruları sorma. Bu yöntem bağlantı testini tamamlamaz.';
 return `Help me set up Claudian in this Gemini website. First check which tools this conversation actually exposes. If Claudian tools exist, call startup_context and follow its instructions. If they do not exist, do not claim to read or write my local Windows files or to have installed memory.\nFor a live connection, help me open Connected Apps → Custom apps for Spark. The feature currently requires eligible Spark access and is limited by Google to personal accounts age 18+, in the US, in English, with Keep Activity on. I can copy my device MCP URL from Claudian. Guide me one screen at a time and never request authentication secrets in chat. Do not send me to Gemini CLI or Antigravity.\nIf custom apps are unavailable, explain that this chat can only work with content I deliberately paste or attach here. Do not ask me to upload my entire vault. Work only with the task and excerpts I choose to provide; propose any note changes for me to save manually. This is manual context sharing, not a connected or verified Claudian installation. Do not start a profile questionnaire or claim permanent memory.`;
}
module.exports={providers,isWeb,guide,geminiGuide};
