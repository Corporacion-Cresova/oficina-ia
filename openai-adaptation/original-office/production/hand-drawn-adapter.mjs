// Reuses supplied repo drawing primitives without inheriting Cresova's brand red.
import * as original from './original-code/amano-original.mjs';
export function createHandDrawnStyle({color,width=9,alpha=0.95}){
 if(typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color))throw Error('EXPLICIT_APPROVED_COLOR_REQUIRED');
 if(!Number.isFinite(width)||width<1||width>30||!Number.isFinite(alpha)||alpha<0||alpha>1)throw Error('INVALID_DRAW_STYLE');
 const style=Object.freeze({color,width,alpha});
 return Object.freeze({circle:(ctx,k,cx,cy,rx,ry)=>original.circulo(ctx,k,cx,cy,rx,ry,style),underline:(ctx,k,x1,x2,y)=>original.subrayado(ctx,k,x1,x2,y,style),arrow:(ctx,k,x1,y1,x2,y2)=>original.flecha(ctx,k,x1,y1,x2,y2,style),check:(ctx,k,x,y,s=1)=>original.palomita(ctx,k,x,y,s,style),cross:(ctx,k,x,y,w,h)=>original.tachado(ctx,k,x,y,w,h,style)});
}
