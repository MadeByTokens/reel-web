// Per-clip picture effects: chroma key, ready-made looks and colour
// adjustments. One small WebGL program does all three in a single pass and
// hands back a canvas the 2D compositor draws like any other picture.

import type { Adjust, Chroma, Clip } from '../doc/model';

/** Brightness, contrast, saturation, warmth, then sepia, fade and vignette. */
type Look = [number, number, number, number, number, number, number];

const LOOKS: Record<string, Look> = {
  Vivid: [0, 0.15, 0.35, 0, 0, 0, 0],
  Bright: [0.08, 0.05, 0.1, 0, 0, 0, 0],
  Warm: [0.02, 0.05, 0.1, 0.6, 0, 0, 0],
  Cool: [0, 0.05, 0.05, -0.6, 0, 0, 0],
  Faded: [0.04, -0.2, -0.25, 0.1, 0, 0.15, 0],
  Vintage: [0, 0.1, -0.2, 0.4, 0.3, 0.08, 0.4],
  Sepia: [0, 0.05, -0.3, 0.2, 0.8, 0, 0],
  Mono: [0, 0.1, -1, 0, 0, 0, 0],
  Noir: [-0.03, 0.45, -1, 0, 0, 0, 0.5],
};
const NONE: Look = [0, 0, 0, 0, 0, 0, 0];

const VERTEX = `
attribute vec2 p;
varying vec2 v;
void main() {
  v = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
varying vec2 v;
uniform sampler2D uTex;
uniform vec3 uKey;
uniform vec3 uChroma;
uniform vec4 uLook;
uniform vec3 uTone;
uniform vec4 uAdjust;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec2 cbcr(vec3 c) {
  return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}
vec3 grade(vec3 c, vec4 a) {
  c += a.x * 0.5;
  c = (c - 0.5) * (1.0 + a.y) + 0.5;
  c = mix(vec3(dot(c, LUMA)), c, 1.0 + a.z);
  c.r += a.w * 0.1;
  c.b -= a.w * 0.1;
  return c;
}
void main() {
  vec4 px = texture2D(uTex, v);
  vec3 c = px.rgb;
  float a = px.a;
  if (uChroma.x > 0.5) {
    float d = distance(cbcr(c), cbcr(uKey));
    a *= smoothstep(uChroma.y, uChroma.y + uChroma.z + 0.001, d);
    // Take the key colour's tint off the edges that remain.
    float spill = 1.0 - smoothstep(uChroma.y, uChroma.y + uChroma.z + 0.12, d);
    c = mix(c, vec3(dot(c, LUMA)), spill);
  }
  c = grade(c, uLook);
  float l = dot(c, LUMA);
  c = mix(c, vec3(l * 1.07, l * 0.95, l * 0.74), uTone.x);
  c = mix(c, vec3(0.5), uTone.y) + uTone.y * 0.12;
  c *= 1.0 - uTone.z * smoothstep(0.35, 0.95, distance(v, vec2(0.5)) * 1.3);
  c = grade(c, uAdjust);
  c = clamp(c, 0.0, 1.0);
  gl_FragColor = vec4(c * a, a);
}`;

const zero = (a: Adjust | undefined): boolean => !a || (!a.brightness && !a.contrast && !a.saturation && !a.warmth);

/** True when a clip has any effect that needs this pass. */
export function needsFx(clip: Clip): boolean {
  return !!clip.chroma || (!!clip.filter && clip.filter in LOOKS) || !zero(clip.adjust);
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

interface Program {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

let program: Program | null = null;
let unavailable = false;

function build(): Program | null {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, depth: false });
  if (!gl) return null;
  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  const uniforms: Program['uniforms'] = {};
  for (const name of ['uKey', 'uChroma', 'uLook', 'uTone', 'uAdjust']) uniforms[name] = gl.getUniformLocation(prog, name);
  // A lost context (the tablet reclaiming memory) is rebuilt the next time it is needed.
  canvas.addEventListener('webglcontextlost', () => {
    if (program?.canvas === canvas) program = null;
  });
  return { gl, canvas, uniforms };
}

/** True when effects can be drawn in this browser; false once building the program has failed. */
export function fxAvailable(): boolean {
  if (!program && !unavailable) {
    program = build();
    unavailable = !program;
  }
  return !!program;
}

/**
 * Returns the picture with the clip's effects applied, `width` by `height`
 * pixels, or null when that cannot be done (the caller then draws it plain).
 * The canvas returned is reused by the next call: draw it straight away.
 */
export function applyFx(
  source: CanvasImageSource,
  clip: { chroma?: Chroma; filter?: string; adjust?: Adjust },
  width: number,
  height: number,
): HTMLCanvasElement | null {
  if (!fxAvailable() || !program) return null;
  const { gl, canvas, uniforms } = program;
  const w = Math.max(1, Math.min(4096, Math.round(width)));
  const h = Math.max(1, Math.min(4096, Math.round(height)));
  try {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    const chroma = clip.chroma;
    gl.uniform3fv(uniforms.uKey!, chroma ? rgb(chroma.color) : [0, 1, 0]);
    gl.uniform3f(uniforms.uChroma!, chroma ? 1 : 0, (chroma?.threshold ?? 0) * 0.5, (chroma?.smooth ?? 0) * 0.3);
    const look = (clip.filter && LOOKS[clip.filter]) || NONE;
    gl.uniform4f(uniforms.uLook!, look[0], look[1], look[2], look[3]);
    gl.uniform3f(uniforms.uTone!, look[4], look[5], look[6]);
    const a = clip.adjust;
    gl.uniform4f(uniforms.uAdjust!, a?.brightness ?? 0, a?.contrast ?? 0, a?.saturation ?? 0, a?.warmth ?? 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (gl.isContextLost()) return null;
    return canvas;
  } catch {
    return null;
  }
}
