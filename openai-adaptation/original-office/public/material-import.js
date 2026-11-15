// Local text preview only. Nothing is sent until the owner approves and saves a brief.
const brands=new Set(['glowfy','velforce','quiba','purify','coden']);
export function prepareMaterial({brandId,name,text}){
 if(!brands.has(brandId)||typeof name!=='string'||!/^.{1,100}\.txt$/i.test(name)||/[\/\\\x00-\x1f]/.test(name))throw Error('Selecciona un archivo .txt de hasta 4 KB.');
 if(typeof text!=='string'||!text.trim()||new TextEncoder().encode(text).length>4096||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))throw Error('Texto vacío, binario o demasiado grande.');
 if(/-----BEGIN .*PRIVATE KEY-----|\b(?:sk-[a-zA-Z0-9_-]{20,}|Bearer\s+[a-zA-Z0-9._-]{16,})|(?:password|contraseña|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S+/i.test(text))throw Error('El archivo parece contener credenciales. Retíralas antes de continuar.');
 return Object.freeze({brandId,name,text,approved:false});
}
export function materialEvidence(material,brandId,approved){
 if(!material)return [];
 if(material.brandId!==brandId||approved!==true)throw Error('Revisa y autoriza este texto para la marca seleccionada.');
 return [{id:'owner-imported-text',source:'Archivo de texto revisado por el usuario; no verificado externamente',text:material.text}];
}
