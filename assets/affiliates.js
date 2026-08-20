/* ============================================================
   アフィリンク自動差し込み（affiliates.js）
   - affiliates.json を読み込み、data-aff="キー" を持つ <a> の
     href を実URLに差し替える。
   - リンクの種類：
       type: "direct" … 直アフィリエイト（そのままのラベル）
       type: "point"  … ポイントサイト経由。via にサイト名を書くと
                         ボタン文言を「〇〇経由で申し込む」に変更。
   - data-aff-banner="キー" の要素にはバナー画像を差し込む。
   - JSON取得に失敗した場合は、HTMLに元から書かれた href / 文言を
     そのまま使う（フォールバック。リンク切れにはならない）。
   ============================================================ */
(function(){
  var url = new URL('../affiliates.json', document.currentScript ? document.currentScript.src : location.href);
  fetch(url.href, { cache: 'no-cache' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(data){
      if(!data) return;
      var links = data.links || {};
      var banners = data.banners || {};

      document.querySelectorAll('a[data-aff]').forEach(function(a){
        var key = a.getAttribute('data-aff');
        var entry = links[key];
        if(!entry) return;

        // 文字列（旧形式）とオブジェクト（新形式）の両対応
        var href, type, via;
        if(typeof entry === 'string'){
          href = entry; type = 'direct';
        } else {
          href = entry.url; type = entry.type || 'direct'; via = entry.via;
        }
        if(href){ a.setAttribute('href', href); }

        // ポイントサイト経由なら文言を差し替える
        // data-aff-keeptext があるボタン（バナー等）は文言を変えない
        if(type === 'point' && via && !a.hasAttribute('data-aff-keeptext')){
          // 「（PR）」表記は残す
          var pr = /（PR）\s*$/.test(a.textContent) ? '（PR）' : '';
          a.textContent = via + '経由で申し込む' + (pr ? ' ' + pr : '');
        }
      });

      document.querySelectorAll('[data-aff-banner]').forEach(function(el){
        var key = el.getAttribute('data-aff-banner');
        var b = banners[key];
        if(!b) return;
        if(el.tagName === 'A' && b.href){ el.setAttribute('href', b.href); }
        var img = el.tagName === 'IMG' ? el : el.querySelector('img');
        if(img && b.img){ img.setAttribute('src', b.img); }
      });
    })
    .catch(function(){ /* 失敗時はHTMLの元hrefをそのまま使う */ });
})();
