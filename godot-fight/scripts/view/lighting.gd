## ライティング一式。画質（0=低 1=中 2=高）で重い効果をオン/オフする。
## アニメ調（セル画風）向け: 明るい空、くっきりした影、エフェクトだけ光らせるブルーム、背景を少しぼかす被写界深度
class_name Lighting
extends Node3D

const QUALITY_NAMES := ["低", "中", "高"]

var env: Environment
var we: WorldEnvironment
var key: DirectionalLight3D
var rim: DirectionalLight3D
var fill: DirectionalLight3D
var cam_attr: CameraAttributesPractical
var quality := 2
var dyn: Array = []   # 一時的な光 [OmniLight3D, 残り, 最大, 元の明るさ]


func build(camera: Camera3D, q: int) -> void:
	env = Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.18, 0.42, 0.92)
	sm.sky_horizon_color = Color(0.72, 0.88, 1.0)
	sm.sky_curve = 0.18
	sm.sky_energy_multiplier = 1.0
	sm.ground_horizon_color = Color(0.72, 0.88, 1.0)
	sm.ground_bottom_color = Color(0.35, 0.6, 0.95)
	sm.sun_angle_max = 6.0
	sm.sun_curve = 0.05
	sky.sky_material = sm
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	# 影の色（セル画の影色）は環境光で決まる: 少し青紫
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.62, 0.6, 0.88)
	env.ambient_light_energy = 0.62
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	env.tonemap_exposure = 1.0
	# ブルーム
	env.glow_enabled = true
	env.glow_normalized = true
	env.set_glow_level(0, 0.0)
	env.set_glow_level(2, 0.6)
	env.set_glow_level(3, 1.0)
	env.set_glow_level(4, 0.8)
	env.set_glow_level(5, 0.4)
	env.glow_intensity = 0.3
	env.glow_strength = 1.0
	env.glow_bloom = 0.08
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	env.glow_hdr_threshold = 1.2
	# 色調
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.1
	env.adjustment_contrast = 1.04
	env.adjustment_brightness = 1.0
	# 遠くを少しかすませる（空気感）
	env.fog_enabled = false
	env.fog_light_color = Color(0.95, 0.6, 0.5)
	env.fog_light_energy = 0.6
	env.fog_sun_scatter = 0.35
	env.fog_density = 0.0035
	env.fog_sky_affect = 0.0
	env.fog_height = -6.0
	env.fog_height_density = 0.04
	we = WorldEnvironment.new()
	we.environment = env
	add_child(we)

	# 主光源: 夕日（手前上から。キャラが見やすい向き）
	key = DirectionalLight3D.new()
	key.rotation_degrees = Vector3(-42, 32, 0)
	key.light_color = Color(1.0, 0.97, 0.9)
	key.light_energy = 1.25
	key.shadow_enabled = true
	key.shadow_blur = 1.5
	key.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	key.directional_shadow_max_distance = 70.0
	key.light_angular_distance = 0.6
	key.light_volumetric_fog_energy = 1.4
	add_child(key)
	# リムライト: 奥（夕日の方向）からの逆光で輪郭を光らせる
	rim = DirectionalLight3D.new()
	rim.rotation_degrees = Vector3(-12, 180 + 10, 0)
	rim.light_color = Color(0.9, 0.95, 1.0)
	rim.light_energy = 0.0
	rim.light_specular = 1.5
	rim.shadow_enabled = false
	rim.light_volumetric_fog_energy = 2.5
	add_child(rim)
	# 補助光: 左上から青紫
	fill = DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-25, -130, 0)
	fill.light_color = Color(0.5, 0.55, 1.0)
	fill.light_energy = 0.0
	fill.light_specular = 0.2
	add_child(fill)

	cam_attr = CameraAttributesPractical.new()
	camera.attributes = cam_attr
	set_quality(q)


func set_quality(q: int) -> void:
	quality = clamp(q, 0, 2)
	var hi := quality == 2
	var mid := quality >= 1
	env.ssao_enabled = mid
	env.ssao_radius = 1.2
	env.ssao_intensity = 1.2
	env.ssao_power = 1.6
	env.ssao_light_affect = 0.15
	env.ssil_enabled = false
	env.ssil_radius = 4.0
	env.ssil_intensity = 0.8
	env.ssr_enabled = false
	env.ssr_max_steps = 48 if hi else 24
	env.ssr_fade_in = 0.15
	env.ssr_fade_out = 2.0
	env.sdfgi_enabled = false
	env.sdfgi_use_occlusion = true
	env.sdfgi_cascades = 4
	env.sdfgi_min_cell_size = 0.25
	env.sdfgi_energy = 0.9
	env.volumetric_fog_enabled = false
	env.volumetric_fog_density = 0.012
	env.volumetric_fog_albedo = Color(1.0, 0.85, 0.75)
	env.volumetric_fog_anisotropy = 0.65
	env.volumetric_fog_length = 90.0
	env.volumetric_fog_ambient_inject = 0.15
	env.volumetric_fog_sky_affect = 0.0
	key.shadow_enabled = mid or quality == 0
	key.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS if mid else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	cam_attr.dof_blur_far_enabled = false
	cam_attr.dof_blur_far_distance = 45.0
	cam_attr.dof_blur_far_transition = 60.0
	cam_attr.dof_blur_amount = 0.04


# ------------------------------------------------------------ 一時的な光（ヒット・火の玉・覚醒・撃墜）
func flash(pos: Vector3, color: Color, energy: float, rng: float, frames: int) -> void:
	var l := OmniLight3D.new()
	l.position = pos
	l.light_color = color
	l.light_energy = energy
	l.omni_range = rng
	l.omni_attenuation = 1.2
	l.light_volumetric_fog_energy = 2.0
	l.shadow_enabled = false
	add_child(l)
	dyn.append([l, frames, frames, energy])


func step() -> void:
	var keep := []
	for d in dyn:
		d[1] -= 1
		var l: OmniLight3D = d[0]
		var k: float = float(d[1]) / d[2]
		l.light_energy = d[3] * k * k
		if d[1] > 0:
			keep.append(d)
		else:
			l.queue_free()
	dyn = keep
