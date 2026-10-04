(function (global) {
  var AvatarRace = global.AvatarRace = global.AvatarRace || {};
  var TAU = AvatarRace.config.TAU;

  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function lerp(a,b,t){ return a+(b-a)*t; }
  function damp(cur,target,lambda,dt){ return lerp(cur,target,1-Math.exp(-lambda*dt)); }
  function dampAngle(cur,target,lambda,dt){
    var d = ((target-cur+Math.PI)%TAU+TAU)%TAU - Math.PI;
    return cur + d*(1-Math.exp(-lambda*dt));
  }
  function mulberry32(a){
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hashStr(s){
    var h = 2166136261;
    for (var i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h,16777619); }
    return h >>> 0;
  }
  function rrect(g,x,y,w,h,r){
    r = Math.min(r, Math.abs(w)/2, Math.abs(h)/2);
    g.beginPath();
    g.moveTo(x+r,y);
    g.lineTo(x+w-r,y); g.arcTo(x+w,y,x+w,y+r,r);
    g.lineTo(x+w,y+h-r); g.arcTo(x+w,y+h,x+w-r,y+h,r);
    g.lineTo(x+r,y+h); g.arcTo(x,y+h,x,y+h-r,r);
    g.lineTo(x,y+r); g.arcTo(x,y,x+r,y,r);
    g.closePath();
  }
  function fmtTime(v){ return (v >= 0 ? v.toFixed(3) : '0.000') + 's'; }   // 毫秒精度
  function dist(a,b){ var dx=b.x-a.x, dy=b.y-a.y; return Math.sqrt(dx*dx+dy*dy); }

  AvatarRace.math = {
    clamp: clamp,
    lerp: lerp,
    damp: damp,
    dampAngle: dampAngle,
    mulberry32: mulberry32,
    hashStr: hashStr,
    rrect: rrect,
    fmtTime: fmtTime,
    dist: dist
  };
})(window);
