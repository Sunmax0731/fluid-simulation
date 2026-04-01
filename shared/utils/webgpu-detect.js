/**
 * WebGPU/WebGL2 検出ユーティリティ
 * WebGPU が利用可能ならデバイスを返し、そうでなければ WebGL2 コンテキストを返す
 */

export async function detectGPU(canvas) {
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });
      if (adapter) {
        const device = await adapter.requestDevice();
        const context = canvas.getContext('webgpu');
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'premultiplied' });
        console.log('[GPU] WebGPU 初期化成功');
        return { type: 'webgpu', device, context, format };
      }
    } catch (e) {
      console.warn('[GPU] WebGPU 初期化失敗:', e);
    }
  }

  // WebGL2 フォールバック
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 も利用できません。ブラウザを更新してください。');

  // 浮動小数点テクスチャ拡張を有効化
  const extFloat = gl.getExtension('EXT_color_buffer_float');
  const extHalf = gl.getExtension('EXT_color_buffer_half_float');
  const floatLinear = gl.getExtension('OES_texture_float_linear');

  const floatSupport = extFloat ? 'RGBA32F' : (extHalf ? 'RGBA16F' : null);
  if (!floatSupport) console.warn('[GPU] 浮動小数点 FBO 非対応、精度が下がります');

  console.log(`[GPU] WebGL2 初期化成功 (float: ${floatSupport})`);
  return { type: 'webgl2', gl, floatSupport, floatLinear: !!floatLinear };
}
