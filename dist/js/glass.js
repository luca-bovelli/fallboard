"use strict";var FBGlass=(()=>{var V=Object.defineProperty;var et=Object.getOwnPropertyDescriptor;var tt=Object.getOwnPropertyNames;var rt=Object.prototype.hasOwnProperty;var it=(r,e,t)=>e in r?V(r,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):r[e]=t;var at=(r,e)=>{for(var t in e)V(r,t,{get:e[t],enumerable:!0})},nt=(r,e,t,s)=>{if(e&&typeof e=="object"||typeof e=="function")for(let i of tt(e))!rt.call(r,i)&&i!==t&&V(r,i,{get:()=>e[i],enumerable:!(s=et(e,i))||s.enumerable});return r};var ot=r=>nt(V({},"__esModule",{value:!0}),r);var m=(r,e,t)=>it(r,typeof e!="symbol"?e+"":e,t);var dt={};at(dt,{GLASS_PRESET:()=>R,GLASS_SELECTOR:()=>C,GlassBackdrop:()=>W,attachGlassMaterials:()=>Ce,measureGlassGeometry:()=>j});var C='.glass-material, [data-material="glass"], .material-glass, .material-glass-active';function Ce(r,e=document){let t=new Map,s=!1,i=!1,l=(o,a)=>{a.unregister(),o.removeAttribute("data-refracted"),a.canvas.remove(),a.changedPosition&&o.style.position==="relative"&&(o.style.position=a.previousPosition),t.delete(o)},n=()=>{if(s=!1,i)return;for(let[a,d]of t)(!a.isConnected||d.canvas.parentElement!==a||!e.contains(a)||!a.matches(C))&&l(a,d);let o=[...e.querySelectorAll(C)];e instanceof HTMLElement&&e.matches(C)&&o.unshift(e);for(let a of o){if(t.has(a)||[...a.children].some(y=>y.matches("canvas.glass-refraction")))continue;let d=document.createElement("canvas");d.className="glass-refraction",d.setAttribute("aria-hidden","true"),d.dataset.glassRenderer="webgl";let p=a.style.position,h=getComputedStyle(a).position==="static";h&&(a.style.position="relative"),a.prepend(d),t.set(a,{canvas:d,unregister:r.register(d),previousPosition:p,changedPosition:h})}r.invalidate()},g=new MutationObserver(()=>{s||i||(s=!0,queueMicrotask(n))});return g.observe(e,{subtree:!0,childList:!0,attributes:!0,attributeFilter:["class","data-material"]}),n(),()=>{i=!0,g.disconnect();for(let[o,a]of t)l(o,a)}}var R=Object.freeze({shapeN:2,capFlatness:.8,lightingZScale:.04,indexOfRefraction:1.46,surfaceRoughness:.01,backgroundGap:0,rimGain:.14,lightingBrightness:1,overlayOpacity:.42,overlayColour:Object.freeze([.2980392156862745,.2980392156862745,.2980392156862745]),transmissionTint:Object.freeze([.88,.89,.91])});function j(r){let e=r.getBoundingClientRect(),t=getComputedStyle(r),s=t.borderTopLeftRadius.split(/\s+/),i=r.offsetWidth?e.width/r.offsetWidth:1,l=r.offsetHeight?e.height/r.offsetHeight:1,n=(d,p,h)=>d.endsWith("%")?parseFloat(d)/100*p:parseFloat(d)*h,g=n(s[0]||"0",e.width,i),o=n(s[1]||s[0]||"0",e.height,l),a=parseFloat(t.getPropertyValue("--glass-lighting-brightness"));return{left:e.left,top:e.top,width:e.width,height:e.height,radius:Math.max(0,Math.min(Number.isFinite(g)?g:0,Number.isFinite(o)?o:0,e.width/2,e.height/2)),lightingBrightness:Number.isFinite(a)?Math.max(0,a):R.lightingBrightness}}var Oe="attribute vec2 position; varying vec2 uv; void main(){ uv=position*.5+.5; gl_Position=vec4(position,0.,1.); }",D=`
vec3 linearColour(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 displayColour(vec3 c){c=max(c,vec3(0.));return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));}
`,Q=`precision highp float; varying vec2 uv; uniform sampler2D scene; uniform vec2 linearRange;
${D}
void main(){gl_FragColor=vec4(linearColour(texture2D(scene,vec2(uv.x,mix(linearRange.x,linearRange.y,uv.y))).rgb),1.);}`;var H=`// Shared by glass geometry and the modal silhouette. Returns value and analytic derivative.
float squircleHinge(float q,float e){float root=sqrt(q*q+e*e);return q<0.?e*e/max(root-q,.00000001):q+root;}
vec2 squircleAxis(float x,float halfExtent,float r,float softness){
 if(abs(halfExtent-r)<.000001)return vec2(x*x/(r*r),2.*x/(r*r));
 float e=r*softness,c=halfExtent-r;
 float qp=x-c,qm=-x-c,rp=sqrt(qp*qp+e*e),rm=sqrt(qm*qm+e*e);
 float vp=squircleHinge(qp,e),vm=squircleHinge(qm,e),v0=squircleHinge(-c,e);
 float edgeP=squircleHinge(r,e),edgeM=squircleHinge(r-2.*halfExtent,e);
 float denominator=max((edgeP-v0)*(edgeP+v0)+(edgeM-v0)*(edgeM+v0),.00000001);
 return vec2(max(0.,((vp-v0)*(vp+v0)+(vm-v0)*(vm+v0))/denominator),2.*(vp*vp/max(rp,.00000001)-vm*vm/max(rm,.00000001))/denominator);
}
`;var w=Object.freeze({maxSigma:12,horizontalReach:320,horizontalViewportFraction:.24,horizontalInset:96,horizontalInsetFraction:.2,verticalReach:200,verticalViewportFraction:.22,verticalInset:108}),M=w,U=r=>r.toFixed(4),ke=`
float proximity(vec2 position){
  float horizontal=smoothstep(blurRectangle.x-min(${U(M.horizontalReach)},viewport.x*${U(M.horizontalViewportFraction)}),blurRectangle.x+min(${U(M.horizontalInset)},blurRectangle.z*${U(M.horizontalInsetFraction)}),position.x);
  float vertical=smoothstep(max(0.,blurRectangle.y-min(${U(M.verticalReach)},viewport.y*${U(M.verticalViewportFraction)})),min(viewport.y,blurRectangle.y+${U(M.verticalInset)}),position.y);
  return mix(horizontal,vertical,blurAxis);
}`,Ne=`precision highp float; varying vec2 uv;
uniform sampler2D scene; uniform vec2 viewport; uniform vec2 direction;
uniform vec4 rectangle; uniform vec4 sourceRectangle; uniform vec4 blurRectangle;
uniform float blurAxis; uniform float blurProgress; uniform float maxRadius; uniform float sampleStep;
${ke}
${D}
vec3 readScene(vec2 screen){
  vec3 colour=texture2D(scene,clamp((screen-sourceRectangle.xy)/sourceRectangle.zw,vec2(0.),vec2(1.))).rgb;
#ifdef LINEAR_BLUR
  return colour;
#else
  return linearColour(colour);
#endif
}
void main(){
  vec2 screen=rectangle.xy+uv*rectangle.zw;
  float sigma=maxRadius*proximity(screen)*blurProgress;
  if(sigma<.05){
#ifdef LINEAR_BLUR
    gl_FragColor=vec4(readScene(screen),1.);
#else
    gl_FragColor=vec4(displayColour(readScene(screen)),1.);
#endif
    return;
  }
  vec3 colour=readScene(screen); float total=1.;
  // Gaussian weights use a recurrence: only one exponential per output pixel.
  float factor=exp(-.5*sampleStep*sampleStep/(sigma*sigma));
  float ratio=factor*factor, weight=1.;
#ifdef LINEAR_BLUR
  // Pair adjacent texel taps using hardware linear interpolation. The Gaussian
  // weights and support remain identical to the dense kernel below.
  for(int pair=0;pair<36;pair++){
    float i=float(pair*2+1),offset=i*sampleStep;
    if(offset>3.*sigma) break;
    float first=weight*factor;factor*=ratio;
    float second=first*factor;factor*=ratio;weight=second;
    if(offset+sampleStep>3.*sigma)second=0.;
    float combined=first+second;
    float position=offset+sampleStep*second/combined;
    vec2 delta=direction*position;
    colour+=(readScene(screen+delta)+readScene(screen-delta))*combined;
    total+=2.*combined;
  }
  gl_FragColor=vec4(colour/total,1.);
#else
  for(int i=1;i<=72;i++){
    float offset=float(i)*sampleStep;
    if(offset>3.*sigma) break;
    weight*=factor; factor*=ratio;
    vec2 delta=direction*offset;
    colour+=(readScene(screen+delta)+readScene(screen-delta))*weight;
    total+=2.*weight;
  }
  gl_FragColor=vec4(displayColour(colour/total),1.);
#endif
}`,Xe=`precision highp float; varying vec2 uv;
uniform sampler2D scene; uniform vec2 viewport; uniform vec4 rectangle;
uniform float radius; uniform float bottomSquare; uniform vec4 modalRectangle;
uniform vec4 blurRectangle; uniform vec4 sourceRectangle;
uniform float blurProgress; uniform float blurAxis; uniform float maxRadius;
${ke}
${D}
${H}
void main(){
  vec2 screen=rectangle.xy+vec2(uv.x,1.-uv.y)*rectangle.zw;
  float sigma=maxRadius*proximity(screen)*blurProgress;
  if(sigma<=.001) discard;
  vec2 panelLocal=screen-(modalRectangle.xy+modalRectangle.zw*.5);
  float r=min(radius,min(modalRectangle.z,modalRectangle.w)*.5);
  float panelField=r>.001?squircleAxis(panelLocal.x,modalRectangle.z*.5,r,.5).x+squircleAxis(panelLocal.y,modalRectangle.w*.5,r,.5).x:2.;
  bool panelInside=panelField<1.;
  if(bottomSquare>.5 && panelLocal.y>=0.) panelInside=abs(panelLocal.x)<modalRectangle.z*.5 && panelLocal.y<modalRectangle.w*.5;
  if(panelInside) discard;
  vec2 coord=clamp((screen-sourceRectangle.xy)/sourceRectangle.zw,vec2(0.),vec2(1.));
  vec3 colour=texture2D(scene,coord).rgb;
#ifndef LINEAR_BLUR
  colour=linearColour(colour);
#endif
  colour*=1.-blurProgress*.30*proximity(screen);
  // Coverage only antialiases the zero-radius boundary; the kernel itself changes per pixel.
  gl_FragColor=vec4(displayColour(colour),smoothstep(0.,.5,sigma));
}`;function qe(r){let e=r.getExtension("OES_texture_half_float");if(!e||!r.getExtension("OES_texture_half_float_linear")||!r.getExtension("EXT_color_buffer_half_float"))return;let t=r.createTexture(),s=r.createFramebuffer();try{if(r.bindTexture(r.TEXTURE_2D,t),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texImage2D(r.TEXTURE_2D,0,r.RGBA,2,2,0,r.RGBA,e.HALF_FLOAT_OES,null),r.bindFramebuffer(r.FRAMEBUFFER,s),r.framebufferTexture2D(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,t,0),r.checkFramebufferStatus(r.FRAMEBUFFER)===r.FRAMEBUFFER_COMPLETE)return e.HALF_FLOAT_OES}finally{r.bindFramebuffer(r.FRAMEBUFFER,null),r.deleteFramebuffer(s),r.deleteTexture(t)}}function Ve(r,e,t){let s=r.createProgram(),i=[],l=(n,g)=>{let o=r.createShader(n);if(r.shaderSource(o,g),r.compileShader(o),!r.getShaderParameter(o,r.COMPILE_STATUS)){let a=r.getShaderInfoLog(o);throw r.deleteShader(o),Error(a||"Shader compile failed")}i.push(o),r.attachShader(s,o)};try{if(l(r.VERTEX_SHADER,e),l(r.FRAGMENT_SHADER,t),r.bindAttribLocation(s,0,"position"),r.linkProgram(s),!r.getProgramParameter(s,r.LINK_STATUS))throw Error(r.getProgramInfoLog(s)||"Shader link failed");return s}catch(n){throw r.deleteProgram(s),n}finally{i.forEach(n=>r.deleteShader(n))}}var je=`void tangentFrame(vec3 n,out vec3 a,out vec3 b){
 a=normalize(cross(abs(n.z)<.95?vec3(0.,0.,1.):vec3(0.,1.,0.),n));
 b=cross(n,a);
}
// Analytic Snell differential for tangent variations of unit incident direction and normal.
vec3 refractionDifferential(vec3 i,vec3 n,float eta,vec3 di,vec3 dn){
 float c=-dot(n,i),root=sqrt(max(.00000001,1.-eta*eta*(1.-c*c)));
 float dc=-dot(dn,i)-dot(n,di);
 return eta*di+(eta-eta*eta*c/root)*dc*n+(eta*c-root)*dn;
}
vec2 backgroundDifferential(vec3 dp,vec3 direction,vec3 dd,float travel){
 vec3 v=dp+travel*dd;
 return (v-direction*(v.z/direction.z)).xy;
}
vec2 frontFootprint(vec3 n,vec3 dn,vec3 inside,vec3 backNormal,vec3 leaving,float glassTravel,float airTravel){
 vec3 di=refractionDifferential(vec3(0.,0.,-1.),n,1./ior,vec3(0.),dn);
 // The rear interface is locally its tangent plane; its macro normal remains fixed.
 float denominator=dot(backNormal,inside);
 vec3 dp=glassTravel*(di-inside*(dot(backNormal,di)/denominator));
 vec3 dd=refractionDifferential(inside,-backNormal,ior,di,vec3(0.));
 return backgroundDifferential(dp,leaving,dd,airTravel);
}
vec3 frostingCovariance(vec3 n,vec3 inside,vec3 backNormal,vec3 leaving,float glassTravel,float airTravel){
 vec3 a,b,c,d;tangentFrame(n,a,b);tangentFrame(-backNormal,c,d);
 vec2 j0=frontFootprint(n,a,inside,backNormal,leaving,glassTravel,airTravel);
 vec2 j1=frontFootprint(n,b,inside,backNormal,leaving,glassTravel,airTravel);
 vec2 j2=backgroundDifferential(vec3(0.),leaving,refractionDifferential(inside,-backNormal,ior,vec3(0.),c),airTravel);
 vec2 j3=backgroundDifferential(vec3(0.),leaving,refractionDifferential(inside,-backNormal,ior,vec3(0.),d),airTravel);
 // Independent, isotropic Gaussian micro-slope variance on each interface: xx, xy, yy.
 return roughness*roughness*vec3(
  j0.x*j0.x+j1.x*j1.x+j2.x*j2.x+j3.x*j3.x,
  j0.x*j0.y+j1.x*j1.y+j2.x*j2.y+j3.x*j3.y,
  j0.y*j0.y+j1.y*j1.y+j2.y*j2.y+j3.y*j3.y);
}
vec2 footprintEigenvalues(vec3 c){
 float delta=sqrt(max(0.,(c.x-c.z)*(c.x-c.z)+4.*c.y*c.y));
 return max(vec2(0.),vec2(c.x+c.z+delta,c.x+c.z-delta)*.5);
}
vec2 gaussianPoint(int i){
 if(i==0)return vec2(0.33750937,-0.00245606);
 if(i==1)return vec2(-0.44082223,0.32246998);
 if(i==2)return vec2(0.06913158,-0.62326308);
 if(i==3)return vec2(0.58453843,0.59851096);
 if(i==4)return vec2(-1.10445364,-0.14641375);
 if(i==5)return vec2(1.08086325,-0.55143875);
 if(i==6)return vec2(-0.37513737,1.10598773);
 if(i==7)return vec2(-0.74678748,-1.13134559);
 if(i==8)return vec2(1.70581467,0.48009137);
 if(i==9)return vec2(-1.89399865,0.63187538);
 if(i==10)return vec2(0.99992733,-1.69659187);
 return vec2(0.87287273,2.19373729);
}
vec3 linearSceneSample(vec2 pixel,float level){
 if(panelPresent>.5&&pixel.x>=modalRectangle.x&&pixel.y>=modalRectangle.y&&pixel.x<=modalRectangle.x+modalRectangle.z&&pixel.y<=modalRectangle.y+modalRectangle.w) return linearColour(panelColour);
 vec2 coord=clamp(pixel/viewport,vec2(0.),vec2(1.));
 if(banded>.5){float r=clamp(coord.y*band.w,band.x,band.x+band.y);coord.y=(r-band.x+band.z)/sceneSize.y;}
 #ifdef HAS_EXPLICIT_LOD
 return texture2DLodEXT(sceneLinear,coord,level).rgb;
 #else
 return texture2D(sceneLinear,coord,level).rgb;
 #endif
}
vec3 frostedBackground(vec2 pixel,vec3 covariance){
 vec2 eigenvalues=footprintEigenvalues(covariance);
 if(eigenvalues.x<.01)return linearSceneSample(pixel,0.);
 // Linear-light mip levels fill the gaps between sparse taps, preventing repeated-edge/grid artifacts.
 // Reserve part of the minor-axis variance for that isotropic prefilter, then subtract its variance.
 vec2 texelSize=viewport/(banded>.5?vec2(sceneSize.x,band.w):sceneSize);
 float baseVariance=eigenvalues.y*.30;
 float level=.5*log2(1.+12.*baseVariance/max(texelSize.x*texelSize.x,texelSize.y*texelSize.y));
 level=min(level,log2(min(sceneSize.x,sceneSize.y)));
 float low=floor(level),fraction=level-low;
 float mipVariance=(mix(exp2(2.*low),exp2(2.*(low+1.)),fraction)-1.)/12.;
 vec3 residual=vec3(max(.000001,covariance.x-mipVariance*texelSize.x*texelSize.x),covariance.y,max(.000001,covariance.z-mipVariance*texelSize.y*texelSize.y));
 float a=sqrt(residual.x),b=residual.y/a,c=sqrt(max(0.,residual.z-b*b));
 vec3 sum=vec3(0.);
 for(int i=0;i<12;i++){
  vec2 q=gaussianPoint(i),offset=vec2(a*q.x,b*q.x+c*q.y);
  sum+=linearSceneSample(pixel+offset,level)+linearSceneSample(pixel-offset,level);
 }
 return sum/24.;
}
`;var He=`float axisValue(float x,float halfExtent,out float derivative){
 vec2 axis=squircleAxis(x,halfExtent,corner,shapeSoftness);derivative=axis.y;return axis.x;
}
float verticalHeight(float value){
 // The z axis has halfExtent=r, so this is the exact inverse of the same axis equation.
 return corner*sqrt(max(0.,value));
}
float solidValue(vec3 p){
 float dx,dy,dz;
 float s=axisValue(p.x,rectangle.z*.5,dx)+axisValue(p.y,rectangle.w*.5,dy);
 if(capFlatness>=1.)return max(s,abs(p.z)/corner)-1.;
 if(abs(p.z)>corner)return max(abs(p.z)/corner-1.,.000001);
 float a=axisValue(p.z,corner,dz),q=1.-capFlatness;
 return s+q*a/max(.0000001,1.-capFlatness*a)-1.;
}
vec3 solidNormal(vec3 p){
 float dx,dy,dz;float ax=axisValue(p.x,rectangle.z*.5,dx),ay=axisValue(p.y,rectangle.w*.5,dy);
 if(capFlatness>=1.){
  if(abs(p.z)/corner>=ax+ay)return vec3(0.,0.,sign(p.z));
  return normalize(vec3(dx,dy,0.));
 }
 float a=axisValue(p.z,corner,dz),denominator=max(.0000001,1.-capFlatness*a);
 return normalize(vec3(dx,dy,(1.-capFlatness)*dz/(denominator*denominator)));
}
void surface(vec2 p,out float distance,out vec3 optical,out vec3 lighting,out float z,out float bevel){
 vec2 halfSize=rectangle.zw*.5;
 if(corner<.001){distance=max(abs(p.x)-halfSize.x,abs(p.y)-halfSize.y);optical=vec3(0.,0.,1.);lighting=optical;z=0.;bevel=0.;return;}
  float dx,dy;float sum=axisValue(p.x,halfSize.x,dx)+axisValue(p.y,halfSize.y,dy);
  // This estimate controls antialiasing only. It does not generate height or normals.
  distance=(sum-1.)/max(length(vec2(dx,dy)),.00001);
  float remaining=clamp(1.-sum,0.,1.),q=1.-capFlatness;
  if(capFlatness>=1.){z=corner;optical=vec3(0.,0.,1.);lighting=optical;}
  else{
   float denominator=q+capFlatness*remaining;
   float vertical=remaining/max(denominator,.00000001);
   z=verticalHeight(vertical);
   float dz;float unused=axisValue(z,corner,dz);
   float slope=q/max(denominator*denominator,.00000001);
   vec3 g=vec3(slope*dx,slope*dy,dz);
   optical=normalize(g);
   lighting=normalize(vec3(g.xy,g.z/lightScale));
  }
  bevel=1.;

}
`;var We=`void main(){
 vec2 p=vec2(uv.x,1.-uv.y)*rectangle.zw-rectangle.zw*.5;
 vec2 screen=rectangle.xy+rectangle.zw*.5+p;
 vec3 normal,lightingNormal;float distance,height,bevel;
 surface(p,distance,normal,lightingNormal,height,bevel);
 if(distance>.7)discard;
 float tir,glassTravel,airTravel;vec3 inside,exitPoint,backNormal,leaving;
 vec2 bend=displacement(p,normal,height,tir,inside,exitPoint,backNormal,leaving,glassTravel,airTravel);
 float frontReflection=dielectricFresnel(normal.z,1.,ior);
 float rearReflection=tir>.5?1.:dielectricFresnel(dot(inside,-backNormal),ior,1.);
 vec3 covariance=vec3(0.);
 if(tir<.5&&roughness>0.&&corner>.001)
  covariance=frostingCovariance(normal,inside,backNormal,leaving,glassTravel,airTravel);
 vec3 transmission=vec3(0.);
 if(tir<.5)transmission=(1.-frontReflection)*(1.-rearReflection)*transmissionTint*frostedBackground(screen+bend,covariance);
 // Figma-style coating uses display-space alpha; optics and rim remain linear-light.
 transmission=linearColour(mix(displayColour(transmission),overlayColour,overlayOpacity));
 // Approved normal-based rim: added after transmission, never blurred.
 float rim=abs(lightingNormal.y)*(1.-abs(lightingNormal.x));
 vec3 illumination=vec3(rimGain*lightingBrightness*rim);
 gl_FragColor=vec4(displayColour(transmission+illumination),1.-smoothstep(-.65,.65,distance));
}
`;var $e=`vec2 displacement(vec2 p,vec3 normal,float z,out float tir,out vec3 inside,out vec3 exitPoint,out vec3 backNormal,out vec3 leaving,out float glassTravel,out float airTravel){
 inside=refract(vec3(0.,0.,-1.),normal,1./ior);
 exitPoint=vec3(p,z);backNormal=vec3(0.,0.,-1.);glassTravel=0.;airTravel=0.;
 if(corner<.001){leaving=vec3(0.,0.,-1.);tir=0.;airTravel=backgroundGap;return vec2(0.);}
 // One centre ray is intersected with the symmetric solid. Frosting does not retrace it per tap.
 vec3 entry=vec3(p,z);float low=.00001,high=length(vec3(rectangle.zw,corner*2.))+1.;
 for(int iteration=0;iteration<18;iteration++){
  float middle=(low+high)*.5;
  if(solidValue(entry+inside*middle)<=0.)low=middle;else high=middle;
 }
 glassTravel=(low+high)*.5;exitPoint=entry+inside*glassTravel;
 backNormal=solidNormal(exitPoint);
 leaving=refract(inside,-backNormal,ior);
 tir=dot(leaving,leaving)<.01||leaving.z>=-.00001?1.:0.;
 if(tir>.5)return vec2(0.);
 airTravel=max(0.,(-corner-backgroundGap-exitPoint.z)/leaving.z);
 return exitPoint.xy+leaving.xy*airTravel-p;
}

float dielectricFresnel(float cosine,float incidentIOR,float transmittedIOR){
 float c=clamp(abs(cosine),0.,1.),eta=incidentIOR/transmittedIOR;
 float k=1.-eta*eta*(1.-c*c);
 if(k<=0.)return 1.;
 float ct=sqrt(k);
 float rs=(incidentIOR*c-transmittedIOR*ct)/max(incidentIOR*c+transmittedIOR*ct,.000001);
 float rp=(transmittedIOR*c-incidentIOR*ct)/max(transmittedIOR*c+incidentIOR*ct,.000001);
 return .5*(rs*rs+rp*rp);
}
`;var ee=r=>Number.isInteger(r)?r.toFixed(1):String(r),mt=[["shapeSoftness",1/R.shapeN],["capFlatness",R.capFlatness],["lightScale",R.lightingZScale],["ior",R.indexOfRefraction],["roughness",R.surfaceRoughness],["backgroundGap",R.backgroundGap],["rimGain",R.rimGain],["overlayOpacity",R.overlayOpacity]],Ke=["precision highp float; varying vec2 uv;","uniform sampler2D sceneLinear; uniform vec2 viewport; uniform vec2 sceneSize;","uniform vec4 rectangle; uniform float corner; uniform float lightingBrightness;","uniform vec4 modalRectangle; uniform float panelPresent; uniform vec3 panelColour;","uniform vec4 band; uniform float banded;",...mt.map(([r,e])=>"const float "+r+" = "+ee(e)+";"),"const vec3 transmissionTint = vec3("+R.transmissionTint.map(ee).join(",")+");","const vec3 overlayColour = vec3("+R.overlayColour.map(ee).join(",")+");",D,H,He,$e,je,We].join(`
`);/* Fallboard: only the parts of the scene a glass can sample are processed. A glass samples the
   scene within its own rectangle, bent by its refraction and spread by its frosting: well within
   96 px of it. So the scene is cut into horizontal bands reaching that far above and below each
   glass (merged where they meet), and only those are uploaded, linearised and mipmapped: on a
   phone, with glass at the top and bottom of the screen, about half the pixels or fewer. The
   bands keep the whole scene's texel density and its alignment to mipmap blocks
   (prepareMaterialScene), and each glass maps its positions into its band, so every glass
   samples what it sampled before, texel for texel. Where the bands would cover most of the
   screen the whole scene is used as before; options.bands false turns them off. In the
   scene's pixels: a band's rows (top to end), and where it sits in the stacked copy (at). */
function bandsOf(targets,H,s){const M=96*s,G=40,iv=targets.map(c=>[Math.max(0,Math.floor(c.rect.top*s-M)),Math.min(H,Math.ceil(c.rect.bottom*s+M)),c]).filter(v=>v[1]>v[0]).sort((x,y)=>x[0]-y[0]),bands=[];for(const[x,y,c]of iv){const last=bands[bands.length-1];if(last&&x<=last.end+G){last.end=Math.max(last.end,y);last.of.push(c)}else bands.push({top:x,end:y,of:[c]})}let at=G;for(const band of bands){band.height=band.end-band.top;band.at=at;at+=band.height+G;for(const c of band.of)c.band=band}if(!bands.length||at-G>=H*.75)return null;return{bands,height:at,key:bands.map(b=>b.top+","+b.height).join(";")}}
var W=class{constructor(e={}){this.options=e;m(this,"targets",new Set);m(this,"scene");m(this,"output");m(this,"atlasCopy");m(this,"gl");m(this,"program");m(this,"blurProgram");m(this,"modalProgram");m(this,"linearProgram");m(this,"linearBuffer");m(this,"blurLinearBuffer");m(this,"blurLinearVersion","");m(this,"halfFloatType");m(this,"textureLimit",0);m(this,"vertexBuffer");m(this,"linearUniform",null);m(this,"resizeObserver");m(this,"texture");m(this,"uniforms",{});m(this,"blurUniforms",{});m(this,"modalUniforms",{});m(this,"buffers",[]);m(this,"fallbackReason","");m(this,"failed",!1);m(this,"dirty",!0);m(this,"signature","");m(this,"lastDrawSignature","");m(this,"previous",0);m(this,"layoutVersion","");m(this,"sceneVersion","");m(this,"materialSceneVersion","");m(this,"progressiveVersion","")}invalidate(){this.failed&&this.fallbackReason.includes("atlas exceeds")&&(this.failed=!1,this.signature=""),this.dirty=!0}register(e,t="glass",s){let i=e.getContext("2d");if(!i)return()=>{};let l={canvas:e,context:i,kind:t,surface:s};this.targets.add(l),this.resizeObserver||(this.resizeObserver=new ResizeObserver(()=>this.invalidate()));let n=e.parentElement;return n&&this.resizeObserver.observe(n),this.invalidate(),()=>{var g;this.targets.delete(l),n&&((g=this.resizeObserver)==null||g.unobserve(n)),n==null||n.removeAttribute("data-glass-source-pending"),n==null||n.removeAttribute(t==="glass"?"data-refracted":"data-progressive-blur"),this.invalidate()}}init(){if(this.failed)return!1;if(this.gl)try{return this.ensurePrograms(),!0}catch(s){return this.fallback(String(s)),!1}let e=this.output||document.createElement("canvas"),t=e.getContext("webgl",{alpha:!0,antialias:!1,premultipliedAlpha:!1,preserveDrawingBuffer:!0});if(!t)return this.fallback("WebGL is unavailable"),!1;this.output||(this.output=e,e.addEventListener("webglcontextlost",s=>{s.preventDefault(),this.fallback("WebGL context lost")}),e.addEventListener("webglcontextrestored",()=>{this.failed=!1,this.releaseGPU(),this.signature="",this.lastDrawSignature="",this.sceneVersion="",this.materialSceneVersion="",this.progressiveVersion="",this.layoutVersion="",this.blurLinearBuffer=void 0,this.blurLinearVersion="",this.previous=0,this.dirty=!0})),this.gl=t;try{this.halfFloatType=qe(t),this.textureLimit=t.getParameter(t.MAX_TEXTURE_SIZE);let s=t.createBuffer();this.vertexBuffer=s||void 0,t.bindBuffer(t.ARRAY_BUFFER,s),t.bufferData(t.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),t.STATIC_DRAW),this.ensurePrograms();let i=()=>{let l=t.createTexture();return t.bindTexture(t.TEXTURE_2D,l),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),l};return this.texture=i(),this.linearBuffer={texture:i(),frame:t.createFramebuffer(),width:0,height:0},this.buffers=Array.from({length:2},()=>({texture:i(),frame:t.createFramebuffer(),width:0,height:0})),this.gl=t,this.output=e,this.scene=document.createElement("canvas"),!0}catch(s){return this.releaseGPU(),this.fallback(t.isContextLost()?"WebGL context lost during initialization":String(s)),!1}}ensurePrograms(){let e=this.gl,t=(s,i,l)=>{var a,d;let n=performance.now(),g=Ve(e,Oe,s);e.useProgram(g),e.bindBuffer(e.ARRAY_BUFFER,this.vertexBuffer);let o=e.getAttribLocation(g,"position");e.enableVertexAttribArray(o),e.vertexAttribPointer(o,2,e.FLOAT,!1,0,0);for(let p of i)l[p]=e.getUniformLocation(g,p);return(d=(a=this.options).record)==null||d.call(a,"glass.compile.cpu",performance.now()-n),g};if([...this.targets].some(s=>s.kind==="glass")&&!this.program){let s=e.getExtension("EXT_shader_texture_lod");this.program=t((s?`#extension GL_EXT_shader_texture_lod : enable
#define HAS_EXPLICIT_LOD
`:"")+Ke,["sceneLinear","sceneSize","viewport","rectangle","corner","lightingBrightness","modalRectangle","panelPresent","panelColour","band","banded"],this.uniforms),this.linearProgram||(this.linearProgram=t(Q,[],{}),this.linearUniform=e.getUniformLocation(this.linearProgram,"scene"),this.linearRange=e.getUniformLocation(this.linearProgram,"linearRange"))}if([...this.targets].some(s=>s.kind==="modal")&&!this.modalProgram){let s=this.halfFloatType?`#define LINEAR_BLUR
`:"";this.modalProgram=t(s+Xe,["scene","viewport","rectangle","radius","bottomSquare","modalRectangle","blurProgress","blurRectangle","blurAxis","sourceRectangle","maxRadius"],this.modalUniforms),this.blurProgram=t(s+Ne,["scene","viewport","direction","sampleStep","rectangle","sourceRectangle","blurRectangle","blurAxis","blurProgress","maxRadius"],this.blurUniforms),this.halfFloatType&&!this.linearProgram&&(this.linearProgram=t(Q,[],{}),this.linearUniform=e.getUniformLocation(this.linearProgram,"scene"),this.linearRange=e.getUniformLocation(this.linearProgram,"linearRange"))}}fallback(e="WebGL context lost"){var t,s,i;this.fallbackReason=e,this.failed=!0;for(let{canvas:l}of this.targets)(t=l.parentElement)==null||t.removeAttribute("data-refracted"),(s=l.parentElement)==null||s.removeAttribute("data-progressive-blur"),(i=l.parentElement)==null||i.setAttribute("data-glass-fallback",e)}progressive(e,t,s,i,l,n,g){let o=this.gl,a=this.blurUniforms;o.activeTexture(o.TEXTURE0),o.useProgram(this.blurProgram),o.uniform1i(a.scene,0),o.uniform2f(a.viewport,t,s),o.uniform1f(a.sampleStep,1/i),o.uniform1f(a.maxRadius,w.maxSigma),o.uniform1f(a.blurProgress,g.progress),o.uniform1f(a.blurAxis,g.axis==="y"?1:0),o.uniform4f(a.rectangle,l.x,l.y,l.width,l.height),o.uniform4f(a.blurRectangle,n.x,n.y,n.width,n.height);for(let d=0;d<2;d++){let p=this.buffers[d],h=Math.ceil(l.width*i),y=Math.ceil(l.height*i);if(o.bindTexture(o.TEXTURE_2D,p.texture),(p.width!==h||p.height!==y)&&(o.texImage2D(o.TEXTURE_2D,0,o.RGBA,h,y,0,o.RGBA,this.halfFloatType||o.UNSIGNED_BYTE,null),p.width=h,p.height=y),o.bindFramebuffer(o.FRAMEBUFFER,p.frame),o.framebufferTexture2D(o.FRAMEBUFFER,o.COLOR_ATTACHMENT0,o.TEXTURE_2D,p.texture,0),o.checkFramebufferStatus(o.FRAMEBUFFER)!==o.FRAMEBUFFER_COMPLETE)throw Error("Incomplete progressive blur framebuffer");let z=g.axis==="y"!=!!d;o.uniform2f(a.direction,z?0:1,z?1:0);let f=d?l:new DOMRect(0,0,t,s);o.uniform4f(a.sourceRectangle,f.x,f.y,f.width,f.height),o.bindTexture(o.TEXTURE_2D,d?this.buffers[0].texture:e),o.viewport(0,0,h,y),o.drawArrays(o.TRIANGLE_STRIP,0,4)}return o.bindFramebuffer(o.FRAMEBUFFER,null),this.buffers[1].texture}prepareBlurSource(e,t,s){if(!this.halfFloatType)return this.texture;let i=this.gl;if(!this.blurLinearBuffer){let n=i.createTexture();i.bindTexture(i.TEXTURE_2D,n),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAG_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE),this.blurLinearBuffer={texture:n,frame:i.createFramebuffer(),width:0,height:0}}let l=this.blurLinearBuffer;if(this.blurLinearVersion===s)return l.texture;if(i.bindTexture(i.TEXTURE_2D,l.texture),(l.width!==e||l.height!==t)&&(i.texImage2D(i.TEXTURE_2D,0,i.RGBA,e,t,0,i.RGBA,this.halfFloatType,null),l.width=e,l.height=t),i.bindFramebuffer(i.FRAMEBUFFER,l.frame),i.framebufferTexture2D(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,l.texture,0),i.checkFramebufferStatus(i.FRAMEBUFFER)!==i.FRAMEBUFFER_COMPLETE)throw Error("Incomplete linear blur framebuffer");return i.activeTexture(i.TEXTURE0),i.bindTexture(i.TEXTURE_2D,this.texture),i.useProgram(this.linearProgram),i.uniform1i(this.linearUniform,0),i.uniform2f(this.linearRange,0,1),i.viewport(0,0,e,t),i.drawArrays(i.TRIANGLE_STRIP,0,4),i.bindFramebuffer(i.FRAMEBUFFER,null),this.blurLinearVersion=s,l.texture}prepareMaterialScene(e,t,s,i,BM){let l=this.linearBuffer,n=this.gl,g=2**Math.ceil(Math.log2(Math.ceil(e*s))),o=2**Math.ceil(Math.log2(Math.ceil(t*s)));if(BM){const k=Math.ceil(t*s)/o;let at=0;for(const b of BM.bands){b.R0=Math.floor(b.top/k/32)*32;b.byH=Math.ceil(b.end/k)-b.R0;b.b0=at;at+=Math.ceil(b.byH/32)*32+32}BM.fullH=o;BM.k=k;o=2**Math.ceil(Math.log2(Math.max(1,at-32)))}if(this.materialSceneVersion===i&&l.width)return l.texture;if(n.activeTexture(n.TEXTURE0),n.bindTexture(n.TEXTURE_2D,l.texture),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.LINEAR),(l.width!==g||l.height!==o)&&(n.texImage2D(n.TEXTURE_2D,0,n.RGBA,g,o,0,n.RGBA,n.UNSIGNED_BYTE,null),l.width=g,l.height=o),n.bindFramebuffer(n.FRAMEBUFFER,l.frame),n.framebufferTexture2D(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,l.texture,0),n.checkFramebufferStatus(n.FRAMEBUFFER)!==n.FRAMEBUFFER_COMPLETE)throw Error("Incomplete linear material framebuffer");if(n.useProgram(this.linearProgram),n.uniform1i(this.linearUniform,0),n.bindTexture(n.TEXTURE_2D,this.texture),BM){n.viewport(0,0,g,o),n.clearColor(0,0,0,1),n.clear(n.COLOR_BUFFER_BIT);for(const b of BM.bands)n.viewport(0,b.b0,g,b.byH),n.uniform2f(this.linearRange,(b.R0*BM.k-b.top+b.at)/BM.height,((b.R0+b.byH)*BM.k-b.top+b.at)/BM.height),n.drawArrays(n.TRIANGLE_STRIP,0,4)}else n.uniform2f(this.linearRange,0,1),n.viewport(0,0,g,o),n.drawArrays(n.TRIANGLE_STRIP,0,4);return n.bindFramebuffer(n.FRAMEBUFFER,null),n.bindTexture(n.TEXTURE_2D,l.texture),n.generateMipmap(n.TEXTURE_2D),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.LINEAR_MIPMAP_LINEAR),this.materialSceneVersion=i,l.texture}update(e,t,s,i,l=""){var ie,ae,ne,oe,se,le,ce,fe,ue,me,de,he,ge,pe,k,ve,xe,be,Ee,Re,Te,ye,Fe,we,Le,Se,Ae,_e,Pe,Me,Ue,ze;if(!this.targets.size||document.hidden)return;let n=((ne=(ae=(ie=this.options).root)==null?void 0:ae.call(ie))==null?void 0:ne.dataset.transparency)||document.documentElement.dataset.transparency;if((le=(se=(oe=this.options).reducedTransparency)==null?void 0:se.call(oe))!=null?le:n==="reduce"||n!=="normal"&&matchMedia("(prefers-reduced-transparency: reduce)").matches||matchMedia("(prefers-contrast: more)").matches){this.signature="";for(let{canvas:u}of this.targets)(ce=u.parentElement)==null||ce.removeAttribute("data-refracted"),(fe=u.parentElement)==null||fe.removeAttribute("data-progressive-blur"),(ue=u.parentElement)==null||ue.removeAttribute("data-glass-source-pending");return}let o=this.gl?0:performance.now();if(!this.init())return;o&&((de=(me=this.options).record)==null||de.call(me,"glass.initialize.cpu",performance.now()-o));let a=this.gl,d=this.scene,p=this.output,h=Math.min(devicePixelRatio||1,1.5,this.textureLimit/Math.max(e,t)),y=((pe=(ge=(he=this.options).root)==null?void 0:ge.call(he))==null?void 0:pe.getBoundingClientRect())||new DOMRect(0,0,e,t),z=u=>new DOMRect(u.x-y.x,u.y-y.y,u.width,u.height),f=(ve=(k=[...this.targets].find(u=>u.kind==="modal"))==null?void 0:k.surface)==null?void 0:ve.call(k),E=f?z(f.rectangle):null,v=f?z(f.fieldRectangle):null,x=new DOMRect((f==null?void 0:f.axis)==="x"?Math.max(0,((v==null?void 0:v.x)||0)-Math.min(w.horizontalReach,e*w.horizontalViewportFraction)-w.maxSigma*3):0,(f==null?void 0:f.axis)==="y"?Math.max(0,((v==null?void 0:v.y)||0)-Math.min(w.verticalReach,t*w.verticalViewportFraction)-w.maxSigma*3):0,0,0);x.x=Math.floor(x.x*h)/h,x.y=Math.floor(x.y*h)/h,x.width=e-x.x;let Ye=(f==null?void 0:f.axis)==="y"&&f.bottomSquare?Math.min(t,Math.ceil((((E==null?void 0:E.top)||0)+f.radius)*h)/h):t;x.height=Math.max(1/h,Ye-x.y);let L=(f==null?void 0:f.colour)||[28,28,30],_=[...this.targets].flatMap(u=>{let S=u.canvas.parentElement;if(!(S!=null&&S.isConnected))return[];let N=u.kind==="modal"&&E?E:z(S.getBoundingClientRect());u.kind==="modal"&&Object.assign(u.canvas.style,{left:y.x+x.x+"px",top:y.y+x.y+"px",width:x.width+"px",height:x.height+"px"});let T=u.kind==="modal"?x:N;return T.width<1||T.height<1||T.right<0||T.left>e||T.bottom<0||T.top>t?[]:[{...u,parent:S,panel:N,rect:T,w:Math.ceil(T.width*h),h:Math.ceil(T.height*h),x:0,y:0,geometry:j(S)}]});if(!_.length)return;let O=_.map(u=>[u.rect.x,u.rect.y,u.w,u.h,u.panel.x,u.panel.y,u.panel.width,u.panel.height,u.geometry.radius,u.geometry.lightingBrightness].join(",")).join(";")+":"+((f==null?void 0:f.progress)||0);if(!this.dirty&&O===this.layoutVersion&&s-this.previous<1e3/30)return;let $=e+":"+t+":"+h+":"+(typeof l=="function"?l():l),te=$+":"+O;if(!this.dirty&&te===this.signature)return;this.dirty=!1,this.signature=te,this.layoutVersion=O;let re=performance.now(),K=!1,BM=this.options.bands!==!1&&!_.some(c=>c.kind==="modal")?bandsOf(_,Math.ceil(t*h),h):null,$b=BM?$+"|"+BM.key:$;try{if(a.activeTexture(a.TEXTURE0),this.sceneVersion!==$b){let c=performance.now(),B=Math.ceil(e*h),b=Math.ceil(t*h);(d.width!==B||d.height!==b)&&(d.width=B,d.height=b);let P=d.getContext("2d");if(P.setTransform(h,0,0,h,0,0),P.fillStyle="#000",P.fillRect(0,0,e,t),K=i(P)===!1,K){this.signature="",this.dirty=!0,(be=(xe=this.options).record)==null||be.call(xe,"glass.sourcePending",1);for(let{canvas:G}of this.targets)(Ee=G.parentElement)==null||Ee.setAttribute("data-glass-source-pending","true");if(!this.sceneVersion)return}else{a.bindTexture(a.TEXTURE_2D,this.texture),a.texImage2D(a.TEXTURE_2D,0,a.RGBA,a.RGBA,a.UNSIGNED_BYTE,BM?this.bandAtlas(d,BM):d),this.sceneVersion=$b;for(let{canvas:G}of this.targets)(Re=G.parentElement)==null||Re.removeAttribute("data-glass-source-pending");(ye=(Te=this.options).record)==null||ye.call(Te,"glass.paintAndUpload.cpu",performance.now()-c)}}let u=this.sceneVersion,S=u+":"+O;if(K&&S===this.lastDrawSignature)return;let N=performance.now(),T=_.some(c=>c.kind==="glass")?this.prepareMaterialScene(e,t,h,u,BM):null;(we=(Fe=this.options).record)==null||we.call(Fe,"glass.linearAndMipmap.cpu",performance.now()-N);let Y=this.textureLimit,X=Math.min(Y,Math.ceil(Math.max(e*h,..._.map(c=>c.w))/64)*64),q=0,Z=0,I=0;for(let c of _)q+c.w>X&&(Z+=I+2,q=0,I=0),c.x=q,c.y=Z,q+=c.w+2,I=Math.max(I,c.h);let J=Math.ceil((Z+I)/64)*64;if(X>Y||J>Y)throw Error("Glass atlas exceeds GPU texture limit");(p.width!==X||p.height!==J)&&(p.width=X,p.height=J),a.bindFramebuffer(a.FRAMEBUFFER,null),a.clearColor(0,0,0,0),a.clear(a.COLOR_BUFFER_BIT);let Be=[],Ge=(c,B)=>{var P,G,Ie;let b=c==="glass"?this.uniforms:this.modalUniforms;a.useProgram(c==="glass"?this.program:this.modalProgram),a.activeTexture(a.TEXTURE0),a.bindTexture(a.TEXTURE_2D,B),c==="modal"?(a.uniform4f(b.sourceRectangle,x.x,x.y,x.width,x.height),a.uniform1f(b.maxRadius,w.maxSigma),a.uniform1f(b.blurProgress,(f==null?void 0:f.progress)||0),a.uniform1f(b.blurAxis,(f==null?void 0:f.axis)==="y"?1:0),a.uniform4f(b.blurRectangle,(v==null?void 0:v.x)||0,(v==null?void 0:v.y)||0,(v==null?void 0:v.width)||0,(v==null?void 0:v.height)||0),a.uniform1i(b.scene,0),a.activeTexture(a.TEXTURE0)):(a.uniform1i(b.sceneLinear,0),a.uniform2f(b.sceneSize,this.linearBuffer.width,this.linearBuffer.height),a.uniform1f(b.banded,BM?1:0)),a.uniform2f(b.viewport,e,t),a.uniform1f(b.panelPresent,E?1:0),c==="glass"&&a.uniform3f(b.panelColour,((P=L==null?void 0:L[0])!=null?P:28)/255,((G=L==null?void 0:L[1])!=null?G:28)/255,((Ie=L==null?void 0:L[2])!=null?Ie:30)/255),a.uniform4f(b.modalRectangle,(E==null?void 0:E.x)||0,(E==null?void 0:E.y)||0,(E==null?void 0:E.width)||0,(E==null?void 0:E.height)||0);for(let F of _.filter(Qe=>Qe.kind===c))a.viewport(F.x,F.y,F.w,F.h),a.uniform4f(b.rectangle,F.rect.left,F.rect.top,F.rect.width,F.rect.height),c==="glass"?(a.uniform1f(b.corner,F.geometry.radius),a.uniform1f(b.lightingBrightness,F.geometry.lightingBrightness),BM&&a.uniform4f(b.band,F.band.R0,F.band.byH,F.band.b0,BM.fullH)):(a.uniform1f(b.radius,(f==null?void 0:f.radius)||0),a.uniform1f(b.bottomSquare,f!=null&&f.bottomSquare?1:0)),a.drawArrays(a.TRIANGLE_STRIP,0,4),Be.push(F)},Ze=performance.now();if(T&&Ge("glass",T),(Se=(Le=this.options).record)==null||Se.call(Le,"glass.materialSubmission.cpu",performance.now()-Ze),_.some(c=>c.kind==="modal")){let c=[u,f.progress,f.axis,v.x,v.y,v.width,v.height,x.x,x.y,x.width,x.height].join(":");if(c!==this.progressiveVersion||!this.buffers[1].width){let B=performance.now(),b=this.prepareBlurSource(d.width,d.height,u);this.progressive(b,e,t,h,x,v,f),this.progressiveVersion=c,(_e=(Ae=this.options).record)==null||_e.call(Ae,"glass.progressiveKernel.cpu",performance.now()-B)}Ge("modal",this.buffers[1].texture)}let Je=performance.now(),A=this.atlasCopy||(this.atlasCopy=document.createElement("canvas"));(A.width!==p.width||A.height!==p.height)&&(A.width=p.width,A.height=p.height);let De=A.getContext("2d");De.clearRect(0,0,A.width,A.height),De.drawImage(p,0,0);for(let c of Be)(c.canvas.width!==c.w||c.canvas.height!==c.h)&&(c.canvas.width=c.w,c.canvas.height=c.h),c.context.clearRect(0,0,c.w,c.h),c.context.drawImage(A,c.x,A.height-c.y-c.h,c.w,c.h,0,0,c.w,c.h),c.parent.removeAttribute("data-glass-fallback"),c.parent.setAttribute(c.kind==="glass"?"data-refracted":"data-progressive-blur","true");this.lastDrawSignature=S,this.fallbackReason="",(Me=(Pe=this.options).record)==null||Me.call(Pe,"glass.atlasTransfer.cpu",performance.now()-Je)}catch(u){this.fallback(String(u))}finally{(ze=(Ue=this.options).record)==null||ze.call(Ue,"glass.frame.cpu",performance.now()-re),this.previous=s+Math.max(0,performance.now()-re)}}bandAtlas(d,BM){const A=this.atlasScene||(this.atlasScene=document.createElement("canvas"));(A.width!==d.width||A.height!==BM.height)&&(A.width=d.width,A.height=BM.height);const c=A.getContext("2d");c.setTransform(1,0,0,1,0,0);c.fillStyle="#000";c.fillRect(0,0,A.width,A.height);for(const b of BM.bands)c.drawImage(d,0,b.top,d.width,b.height,0,b.at,d.width,b.height);return A}releaseGPU(){if(this.gl){for(let e of this.buffers)this.gl.deleteTexture(e.texture),this.gl.deleteFramebuffer(e.frame);this.blurLinearBuffer&&(this.gl.deleteTexture(this.blurLinearBuffer.texture),this.gl.deleteFramebuffer(this.blurLinearBuffer.frame)),this.texture&&this.gl.deleteTexture(this.texture),this.program&&this.gl.deleteProgram(this.program),this.blurProgram&&this.gl.deleteProgram(this.blurProgram),this.modalProgram&&this.gl.deleteProgram(this.modalProgram),this.linearProgram&&this.gl.deleteProgram(this.linearProgram),this.vertexBuffer&&this.gl.deleteBuffer(this.vertexBuffer),this.linearBuffer&&(this.gl.deleteTexture(this.linearBuffer.texture),this.gl.deleteFramebuffer(this.linearBuffer.frame))}this.gl=void 0,this.program=this.modalProgram=this.linearProgram=this.blurProgram=void 0,this.texture=void 0,this.vertexBuffer=void 0,this.buffers=[],this.linearBuffer=void 0,this.blurLinearBuffer=void 0,this.blurLinearVersion=""}dispose(){var e;this.fallback(),this.targets.clear(),(e=this.resizeObserver)==null||e.disconnect(),this.releaseGPU(),this.scene=void 0,this.output=void 0,this.atlasCopy=void 0,this.buffers=[],this.linearBuffer=void 0,this.failed=!1,this.dirty=!0,this.signature="",this.lastDrawSignature="",this.layoutVersion="",this.sceneVersion="",this.materialSceneVersion="",this.progressiveVersion=""}};return ot(dt);})();
