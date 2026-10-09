const form=document.getElementById('login'),message=document.getElementById('message');
form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;message.textContent='';try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});const data=await r.json().catch(()=>{throw new Error("This server does not support login. Open http://localhost:3001/login.html.")});if(!r.ok)throw new Error(data.error);location.replace('/terminal');}catch(e){message.textContent=e.message;}finally{button.disabled=false;}};

document.getElementById("showPassword").addEventListener("change", e => { document.getElementById("password").type = e.target.checked ? "text" : "password"; });

async function loadTestAccounts(){
  try{const r=await fetch('/api/auth/test-accounts');if(!r.ok){if(r.status===404){const data=await r.json().catch(()=>({}));if(data.error==='Test login shortcuts are disabled.'){document.getElementById('testAccounts').hidden=true;return;}}throw new Error('Test accounts need the updated backend. Restart locally or redeploy the latest code on Hostinger.');}const {accounts}=await r.json();
    document.getElementById('testAccountButtons').replaceChildren();
    for(const a of accounts){const b=document.createElement('button');b.type='button';b.className='test-account-button';b.textContent=a.label;b.disabled=!a.available;b.title=a.available?'Fill '+a.label+' credentials':'Account unavailable or password changed';
      b.onclick=()=>{form.elements.email.value=a.email;form.elements.password.value=a.password;message.textContent='';document.querySelectorAll('.test-account-button').forEach(x=>x.setAttribute('aria-pressed',x===b));form.querySelector('[type=submit]').focus();};b.setAttribute('aria-pressed','false');document.getElementById('testAccountButtons').append(b);
    }
    document.getElementById('testAccounts').hidden=false;
  }catch(e){document.getElementById('testAccountHint').textContent=e.message||'Could not load testing accounts. Refresh to retry.';}
}
loadTestAccounts();
