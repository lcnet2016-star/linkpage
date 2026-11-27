(() => {
  const cleanup = new WeakMap();
  const rendered = new WeakMap();
  const small = matchMedia("(max-width:700px)");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const escape = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const validGroup = c => typeof c.announcement_group_id === "string" &&
    /^local_[a-f0-9-]{36}$/.test(c.announcement_group_id) ? c.announcement_group_id : "";
  function render(grid, campaigns, upcomingHtml, renderCard, lang="ja") {
    const ja = lang !== "en";
    const label = (j,e) => ja?j:e;
    const groups = new Map();
    for (const card of campaigns) {
      const key=validGroup(card);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(card);
    }
    const e = escape;
    const deckLabel=label("開催中の告知","Current events");
    const decks=[...groups.values()].map(cards => {
      const first=cards[0];
      const title=validGroup(first)?String(first.announcement_group_title||"").trim():"";
      const subtitle=validGroup(first)?String(first.announcement_group_subtitle||"").trim():"";
      const header=title||subtitle?'<div class="campaign-deck-heading">'+
        (title?'<h3 class="campaign-deck-title">'+e(title)+'</h3>':'')+
        (subtitle?'<p class="campaign-deck-subtitle">'+e(subtitle)+'</p>':'')+'</div>':'';
      return '<section class="campaign-deck" data-count="'+cards.length+'" aria-label="'+e(title||subtitle||deckLabel)+'">'+header+
        '<div class="campaign-deck-track">'+cards.map(renderCard).join('')+'</div>'+
        '<div class="campaign-deck-controls" hidden>'+
        '<button type="button" data-action="toggle"></button>'+
        '<button type="button" data-action="prev" aria-label="'+label('前へ','Previous')+'">‹</button>'+
        '<input type="range" min="0" step="1" aria-label="'+label('スライド位置','Slide position')+'">'+
        '<button type="button" data-action="next" aria-label="'+label('次へ','Next')+'">›</button>'+
        '<span class="campaign-deck-position" aria-hidden="true"></span></div></section>';
    });
    const markup=decks.join('')+upcomingHtml;
    const previous=rendered.get(grid);
    if(previous && previous.markup===markup && previous.first===grid.firstElementChild) return;
    cleanup.get(grid)?.();
    grid.innerHTML=markup;
    rendered.set(grid,{markup,first:grid.firstElementChild});
    const disposers=[];
    for(const deck of grid.querySelectorAll(".campaign-deck")) {
      const count=Number(deck.dataset.count);
      if(count<3)continue;
      const track=deck.querySelector(".campaign-deck-track");
      const bar=deck.querySelector(".campaign-deck-controls");
      const toggle=bar.querySelector('[data-action="toggle"]'),range=bar.querySelector("input");
      const position=bar.querySelector(".campaign-deck-position");
      let stopped=false,timer=null,coolUntil=0,hover=false;
      const max=()=>Math.max(0,count-(small.matches?2:3));
      const x=i=>track.children[i]?.offsetLeft-track.firstElementChild.offsetLeft||0;
      const index=()=>{let k=0;for(let i=1;i<=max();i++)if(Math.abs(track.scrollLeft-x(i))<Math.abs(track.scrollLeft-x(k)))k=i;return k};
      const update=()=>{const i=index(),n=max();bar.hidden=n===0;range.max=n;range.value=i;position.textContent=(i+1)+" / "+(n+1);
        range.setAttribute("aria-valuetext",position.textContent);
        toggle.disabled=reduce.matches;
        toggle.textContent=stopped||reduce.matches?"▶":"Ⅱ";
        toggle.setAttribute("aria-label",stopped||reduce.matches?label("自動送りを再開","Play"):label("自動送りを停止","Pause"));
      };
      const go=(i,manual)=>{if(!max())return;if(manual)coolUntil=Date.now()+5500;const clamped=(i+max()+1)%(max()+1);
        track.scrollTo({left:x(clamped),behavior:reduce.matches||Math.abs(clamped-index())>1?"instant":"smooth"});};
      const resize=()=>{if(!max())track.scrollLeft=0;update()};
      toggle.onclick=()=>{stopped=!stopped;update()};
      bar.querySelector('[data-action="prev"]').onclick=()=>go(index()-1,true);
      bar.querySelector('[data-action="next"]').onclick=()=>go(index()+1,true);
      range.oninput=()=>{const i=Number(range.value);coolUntil=Date.now()+5500;track.scrollTo({left:x(i),behavior:"instant"});update()};
      track.addEventListener("scroll",update,{passive:true});
      track.addEventListener("pointerdown",()=>{coolUntil=Date.now()+5500},{passive:true});
      deck.addEventListener("mouseenter",()=>{hover=true});
      deck.addEventListener("mouseleave",()=>{hover=false});
      small.addEventListener("change",resize);reduce.addEventListener("change",update);
      timer=setInterval(()=>{if(!deck.isConnected){dispose();return}if(!stopped&&!reduce.matches&&!hover&&!document.hidden&&!deck.contains(document.activeElement)&&Date.now()>=coolUntil)go(index()+1,false)},4500);
      function dispose(){clearInterval(timer);small.removeEventListener("change",resize);reduce.removeEventListener("change",update)}
      disposers.push(dispose);update();
    }
    cleanup.set(grid,()=>{disposers.forEach(f=>f());cleanup.delete(grid);rendered.delete(grid)});
  }
  window.PolarisCampaignCarousel={render,clear(grid){cleanup.get(grid)?.()}};
})();