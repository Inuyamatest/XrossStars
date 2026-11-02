## アニメ調（セル画風）の見た目: 2段階のくっきりした陰影＋縁の光＋黒い輪郭線。
## キャラ（PMXモデル・仮人形）とステージの両方で使う。
class_name Toon

const SHADER := """
shader_type spatial;
render_mode specular_disabled, cull_disabled;

uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D tex : source_color, filter_linear_mipmap, repeat_enable;
uniform bool use_tex = false;
uniform vec4 shade_color : source_color = vec4(0.62, 0.55, 0.78, 1.0);
uniform float shade_step : hint_range(-1.0, 1.0) = 0.15;
uniform float rim_power = 4.0;
uniform vec4 rim_color : source_color = vec4(1.0, 0.95, 0.85, 1.0);
uniform float rim_strength = 0.25;
uniform float alpha_scissor = 0.4;

void fragment() {
	vec4 c = albedo;
	if (use_tex) {
		c *= texture(tex, UV);
	}
	ALBEDO = c.rgb;
	//ALPHA
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), rim_power);
	EMISSION = rim_color.rgb * fres * rim_strength * c.rgb;
}

void light() {
	float nl = dot(NORMAL, LIGHT);
	float lit = smoothstep(shade_step - 0.03, shade_step + 0.03, nl) * step(0.5, ATTENUATION);
	DIFFUSE_LIGHT += LIGHT_COLOR / PI * mix(0.0, 0.62, lit);
}
"""

const CHAR_SHADER := """
shader_type spatial;
render_mode specular_disabled, cull_disabled;

uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D tex : source_color, filter_linear_mipmap, repeat_enable;
uniform bool use_tex = false;
// MMD のスフィアマップ（髪のツヤ・金属の光沢）: 0=なし 1=乗算 2=加算
uniform sampler2D sph : source_color, filter_linear;
uniform int sph_mode = 0;
// MMD のトゥーンテクスチャ（陰影の階調。上が明るい側）
uniform sampler2D ramp : source_color, filter_linear, repeat_disable;
uniform bool use_ramp = false;
// 影の色（材質の色に掛ける。少し紫寄りにするとアニメっぽい）
uniform vec4 shade_tint : source_color = vec4(0.72, 0.62, 0.86, 1.0);
uniform float shade_step = 0.1;
uniform float shade_soft = 0.04;
uniform float face_soft = 0.0;   // 顔・肌は影を弱く
uniform vec4 rim_color : source_color = vec4(1.0, 0.96, 0.9, 1.0);
uniform float rim_strength = 0.45;
uniform float alpha_scissor = 0.4;

varying vec3 vnorm;

void vertex() {
	vnorm = normalize((MODELVIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec4 c = albedo;
	if (use_tex) {
		c *= texture(tex, UV);
	}
	if (sph_mode > 0) {
		vec2 suv = vec2(vnorm.x * 0.5 + 0.5, -vnorm.y * 0.5 + 0.5);
		vec3 sc = texture(sph, suv).rgb;
		c.rgb = sph_mode == 1 ? c.rgb * sc : c.rgb + sc * 0.55;
	}
	ALBEDO = c.rgb;
	//ALPHA
	// 縁の光（逆光っぽいハイライト）。上側ほど強く
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.5);
	float up = clamp(dot(vnorm, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.6, 0.0, 1.0);
	EMISSION = rim_color.rgb * fres * up * rim_strength * (0.4 + 0.6 * c.rgb);
}

void light() {
	float nl = dot(NORMAL, LIGHT);
	float lit = smoothstep(shade_step - shade_soft, shade_step + shade_soft, nl);
	lit *= mix(step(0.35, ATTENUATION), 1.0, face_soft * 0.7);
	lit = mix(lit, 1.0, face_soft * 0.55);
	vec3 shade = mix(shade_tint.rgb, vec3(1.0), lit);
	if (use_ramp) {
		shade = texture(ramp, vec2(0.5, clamp(1.0 - lit, 0.03, 0.97))).rgb * mix(shade_tint.rgb, vec3(1.0), 0.5 + 0.5 * lit);
	}
	DIFFUSE_LIGHT += LIGHT_COLOR / PI * shade * 0.62;
}
"""

# 画面上で一定の太さになる輪郭線（材質の色を暗くした色で描く）
const OUTLINE_SHADER := """
shader_type spatial;
render_mode unshaded, cull_front, depth_draw_opaque;
uniform vec4 line_color : source_color = vec4(0.1, 0.06, 0.12, 1.0);
uniform float width = 2.2;   // ピクセル

void vertex() {
	vec4 clip = PROJECTION_MATRIX * MODELVIEW_MATRIX * vec4(VERTEX, 1.0);
	vec3 n = (MODELVIEW_MATRIX * vec4(NORMAL, 0.0)).xyz;
	vec2 dir = (PROJECTION_MATRIX * vec4(n, 0.0)).xy;
	if (length(dir) > 0.0001) {
		dir = normalize(dir);
	}
	clip.xy += dir * width * 2.0 / VIEWPORT_SIZE * clip.w;
	POSITION = clip;
}

void fragment() {
	ALBEDO = line_color.rgb;
}
"""

static var _char: Shader
static var _char_cut: Shader
static var _line: Shader
static var _shader: Shader
static var _shader_cut: Shader
static var _outline: StandardMaterial3D


static func shader(cutout := false) -> Shader:
	## cutout: 髪の毛先などの透明部分を切り抜く版（ALPHA を使うと半透明扱いになるので、使わない版と分ける）
	if _shader == null:
		_shader = Shader.new()
		_shader.code = SHADER
		_shader_cut = Shader.new()
		_shader_cut.code = SHADER.replace("//ALPHA", "ALPHA = c.a;\n\tALPHA_SCISSOR_THRESHOLD = alpha_scissor;")
	return _shader_cut if cutout else _shader


static func material(color: Color, tex: Texture2D = null, alpha := false, outline := true, shade := Color(0.6, 0.52, 0.78)) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = shader(alpha)
	m.set_shader_parameter("albedo", color)
	m.set_shader_parameter("use_tex", tex != null)
	if tex != null:
		m.set_shader_parameter("tex", tex)
	m.set_shader_parameter("shade_color", shade)
	if outline:
		m.next_pass = outline_mat()
	return m


static func outline_mat(width := 0.012, color := Color(0.08, 0.05, 0.1)) -> StandardMaterial3D:
	## 裏返した少し太いメッシュを黒で描く（反転法）。スキニングにもそのまま追従する。
	if _outline == null or width != 0.012:
		var o := StandardMaterial3D.new()
		o.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		o.albedo_color = color
		o.cull_mode = BaseMaterial3D.CULL_FRONT
		o.grow = true
		o.grow_amount = width
		if width != 0.012:
			return o
		_outline = o
	return _outline



static func char_material(color: Color, tex: Texture2D, alpha: bool, outline: bool, sph: Texture2D = null, sph_mode := 0,
		ramp: Texture2D = null, face := false, line_w := 2.2) -> ShaderMaterial:
	## キャラ用: MMD のトゥーン・スフィアを使い、色付きの輪郭線（画面上で一定の太さ）を付ける
	if _char == null:
		_char = Shader.new()
		_char.code = CHAR_SHADER
		_char_cut = Shader.new()
		_char_cut.code = CHAR_SHADER.replace("//ALPHA", "ALPHA = c.a;\n\tALPHA_SCISSOR_THRESHOLD = alpha_scissor;")
		_line = Shader.new()
		_line.code = OUTLINE_SHADER
	var m := ShaderMaterial.new()
	m.shader = _char_cut if alpha else _char
	m.set_shader_parameter("albedo", color)
	m.set_shader_parameter("use_tex", tex != null)
	if tex != null:
		m.set_shader_parameter("tex", tex)
	if sph != null and sph_mode > 0:
		m.set_shader_parameter("sph", sph)
		m.set_shader_parameter("sph_mode", sph_mode)
	if ramp != null:
		m.set_shader_parameter("ramp", ramp)
		m.set_shader_parameter("use_ramp", true)
	# 影色は材質の色から作る（彩度を少し上げて暗く、紫寄りに）
	var base := color
	if tex != null:
		var img := tex.get_image()
		if img != null and not img.is_empty():
			var small := img.duplicate()
			small.resize(1, 1, Image.INTERPOLATE_BILINEAR)
			base = small.get_pixel(0, 0)
	var tint := Color(lerp(base.r, 0.62, 0.45), lerp(base.g, 0.5, 0.45), lerp(base.b, 0.78, 0.45))
	tint = tint.lerp(Color(0.72, 0.62, 0.86), 0.5)
	m.set_shader_parameter("shade_tint", tint)
	m.set_shader_parameter("face_soft", 1.0 if face else 0.0)
	if outline:
		var o := ShaderMaterial.new()
		o.shader = _line
		var lc := Color(base.r * 0.32, base.g * 0.26, base.b * 0.34)
		o.set_shader_parameter("line_color", lc)
		o.set_shader_parameter("width", line_w)
		m.next_pass = o
	return m
