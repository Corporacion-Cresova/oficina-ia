import {createLocalRenderer} from './local-renderer.mjs';
import {createCanvasDemoRenderer} from './canvas-demo-renderer.mjs';
// Operator opt-in. No model runner is created by this selector.
export function selectRenderer({local=false,canvasDemo=false,dependenciesVerified=false}={}){
 if(local&&canvasDemo)throw Error('Select exactly one renderer');
 if(canvasDemo){if(!dependenciesVerified)throw Error('Canvas demo runtime dependencies unverified');return createCanvasDemoRenderer({ffmpeg:'/usr/bin/ffmpeg',ffprobe:'/usr/bin/ffprobe'});}
 return local?createLocalRenderer({ffmpeg:'/usr/bin/ffmpeg',ffprobe:'/usr/bin/ffprobe'}):null;
}
