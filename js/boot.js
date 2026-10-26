/* Yume · 启动（js/boot.js）——必须最后加载：所有内容和模块注册完之后再启动 */
(function(){
  try{window.Yume.boot()}
  catch(e){
    console.error("[yume] 启动失败",e);
    var v=document.getElementById("view");
    if(v)v.innerHTML='<div class="card" style="margin-top:24px"><b>页面加载出错了</b><div class="small muted">请刷新重试。如果一直这样，请把这句话发给作者：'+String(e&&e.message||e).replace(/[<>&]/g,"")+'</div></div>';
  }
})();
