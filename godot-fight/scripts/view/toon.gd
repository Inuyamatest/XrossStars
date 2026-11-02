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
