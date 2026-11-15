// Original scene. Compatible with oficina estudio-video draw(ctx,t,{W,H}) contract.
// No claimed product UI: illustrative cards, not Velforce screenshots.
const clamp=x=>Math.max(0,Math.min(1,x));
const ease=x=>1-Math.pow(1-clamp(x),3);
const mix=(a,b,t)=>a+(b-a)*t;
function box(c,x,y,w,h,r,color){c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();}
function text(c,s,x,y,size=26,color='#f7f5f0',weight=700){c.fillStyle=color;c.font=`${weight} ${size}px "DejaVu Sans"`;c.fillText(s,x,y);}
export function draw(c,t,{W=540,H=960,brandName="Marca",headings=["TE ESCRIBIÓ. ¿Y después?","QUE NO SE TE PIERDA.","Dale un siguiente paso."],durations=[2,2,3]}={}){
 c.save();c.scale(W/540,H/960);
 const bg=c.createLinearGradient(0,0,540,960);bg.addColorStop(0,'#151a23');bg.addColorStop(1,'#070b12');c.fillStyle=bg;c.fillRect(0,0,540,960);
 // Deliberate non-brand neutral palette for technical proof.
 const halo=c.createRadialGradient(250,475,10,250,475,400);halo.addColorStop(0,'#223447');halo.addColorStop(1,'#10151e00');c.fillStyle=halo;c.fillRect(0,0,540,960);
 c.strokeStyle='#ffffff07';c.lineWidth=1;for(let i=0;i<10;i++){c.beginPath();c.moveTo(-100,520+i*35);c.lineTo(700,440+i*35);c.stroke();}
 const transition=durations[0],ending=durations[0]+durations[1];
 const phase=ease((t-transition)/.7), close=ease((t-ending)/.6);
 const titleA=1-ease((t-transition)/.25), titleB=ease((t-transition)/.35)*(1-close);
 c.globalAlpha=titleA;heading(c,headings[0]);
 c.globalAlpha=titleB;heading(c,headings[1]);c.globalAlpha=1;
 // Device thick edge: black physical phone, restrained perspective.
 c.save();c.translate(mix(225,275,phase),480);c.rotate(mix(-.13,.025,phase));c.transform(1,0,-.11*(1-phase),1,0,0);
 for(let z=18;z>=0;z-=3)box(c,-128+z,-226+z,256,456,35,z?'#030407':'#454e59');
 box(c,-124,-222,248,448,32,'#0a0d12');box(c,-111,-207,222,418,25,'#202934');box(c,-40,-199,80,15,9,'#080b10');
 text(c,phase<.5?'Mensajes':'Seguimiento',-89,-156,20,'#edf1f5');
 for(let i=0;i<3;i++)box(c,-88,-126+i*91,176,70,12,'#2e3946');
 c.restore();
 // Message cards move independently from scattered inbox to an ordered visual sequence.
 for(let i=0;i<3;i++){
 const enter=ease((t-.2-i*.3)/.45), p=ease((t-transition-i*.12)/.7);
 const x=mix([164,320,195][i],277,p), y=mix([380,505,625][i],364+i*91,p);
 c.save();c.translate(x+mix(-45,0,enter),y);c.rotate(mix([-.1,.1,-.065][i],.025,p));c.globalAlpha=enter;
 c.shadowColor='#00000066';c.shadowBlur=22;c.shadowOffsetY=14;
 box(c,-123,-35,246,70,14,'#e9edf0');c.shadowColor='transparent';
 box(c,-105,-17,34,34,17,'#536c7e');text(c,['A','B','C'][i],-96,6,16);
 text(c,['¿Tienes información?','Quiero una cotización','¿Podemos hablar?'][i],-60,-3,13,'#17232e');
 text(c,p>.6?['Por responder','Próximo paso','Seguimiento'][i]:'Nuevo mensaje',-60,18,12,'#52687b',400);
 if(p>.6){c.strokeStyle='#718b9d';c.lineWidth=2;c.beginPath();c.arc(106,0,7,0,Math.PI*2);c.stroke();}
 c.restore();
 }
 c.globalAlpha=1-close;text(c,'EJEMPLO VISUAL · NO ES LA INTERFAZ',42,769,13,'#93a4b6',400);c.globalAlpha=1;
 if(close>0){c.fillStyle=`rgba(10,15,23,${close*.94})`;c.fillRect(0,100,540,720);c.globalAlpha=close;text(c,brandName,42,388,55);text(c,headings[2],42,444,26,'#b8cfdd');text(c,'Prueba técnica · No es una pieza final',42,498,17,'#8d9ba9',400);c.globalAlpha=1;}
 text(c,'DEMO · SIN VOZ · NO PUBLICAR',42,883,17,'#93a4b6',400);
 c.restore();
}

function heading(c,s){const words=s.split(/\s+/);let lines=["" ];for(const w of words){let i=lines.length-1;if((lines[i]+" "+w).trim().length>20)lines.push(w);else lines[i]+=(lines[i]?" ":"")+w;}lines.slice(0,3).forEach((l,i)=>text(c,l,42,160+i*47,35,i?"#b8cfdd":"#f7f5f0"));}
