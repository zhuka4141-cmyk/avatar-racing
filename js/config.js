(function (global) {
  var AvatarRace = global.AvatarRace = global.AvatarRace || {};

  var TAU = Math.PI * 2;
  var LANE_SPEED = 62;                         // 变道横移速度（世界单位/秒）：匀速并入，起步不甩、到位不蹭
  var CAR_W = 46;                              // 车身宽（含轮，世界单位）
  var CAR_LEN = 78;                            // 车长
  var MAX_OVERLAP = 0.5;                       // 允许的最大重叠面积占比（超过就横向让位）
  var LANES = 14;                              // 并排车位数量（赛道宽度由它决定）
  var LANE_STEP = 60;                          // 相邻车道中心间距（车身宽 46）
  var LANE_MAX = (LANES - 1) / 2 * LANE_STEP;  // 390：最外侧车位中心
  var HALF_W = LANE_MAX + 24;                  // 414：14 个车位 + 路缘
  var RACE_DIST = 9000;
  var FWD_RUNOFF = 1400;
  var VIEW_H = 820;
  var MIN_VIEW_W = 2 * HALF_W + 140;           // 视野至少完整放下整条赛道
  var PALETTE = ['#f2994a','#eb5757','#2d9cdb','#27ae60','#9b51e0','#f2c94c','#56ccf2','#bb6bd9','#f2789f','#4ecdc4'];

  /* ---- 内定（指定某人夺冠）--------------------------------------------- *
   * 目标：一定夺冠，但全程看起来就是个普通选手。
   * 关键约束（实测出来的）：自然产生的冠军也是「中段乱斗、末段发力」，
   * 全程待在前三反而最可疑。所以中段不给任何额外加速 —— 让它和所有人
   * 一样被追赶机制反复超越、掉到中游，只在最后一段才把差距收回来。
   *   ① 基准速度 baseSpeed 只比场上最快的人高一点点（界面上不显示速度，不可见）。
   *   ② 中段完全不加成（和普通车走同一条公式），所以它照样会被超车。
   *   ③ 终盘按「与最强对手的差距」做伺服：落后就补，领先过多就收，
   *      把领先量收敛到 endTarget 那一丁点，冲线像险胜而不是碾压。
   *   ④ 最后一段留一档「最后一口气」兜底，确保是它先压线。
   * 被指定的人从第一排发车（见 createCars）。
   *
   * 怎么调「明显程度」（改完跑 node qa_rig.js 看指标）：
   *   - 想更稳地夺冠     → 调大 servoChase；想更不显眼 → 调小
   *   - 想赢得多一点/少一点 → 调 endTarget（它就是冲线时的领先量）
   *   - 想让它更早发力     → 调大 endSpan（中段就更像强队，也更显眼）
   *   - 想让它多被超几次 → 调小 baseEdge，或调大 endSpan 之外不动（baseEdge 越小越不起眼）
   *   - 第一排的具体格子是每局随机的（createCars 里的 wantGi），只保证在第一排
   * 所有参数都只在「被指定的人」身上生效，对其他人逐位无影响（qa_physics.js 可证）。
   * -------------------------------------------------------------------- */
  var RIG = {
    baseEdge:  0.030,   // 相对场上最快 baseSpeed 的额外比例（不可见）
    endSpan:   3200,    // 终盘长度（世界单位）—— 只在这最后一段才发力
    endTarget: 140,     // 终盘想保持的领先量（约 0.3 秒；自然冠军最大领先就是 147 这个量级）
    servoHalf: 140,     // 伺服误差半饱和点（越小越「硬」）
    servoChase:0.40,    // 终盘「还落后」时的强度 —— 稳定夺冠的保证
    servoHold: 0.12,    // 终盘「领先过多」时的收油强度 —— 不把差距拉开
    paceDamp:  0.60,    // 后半程压掉自身速度波动的比例（让终盘更可控）
    lockSpan:  600,     // 「最后一口气」的长度（世界单位）
    lockLead:  320,     // 「最后一口气」的触发领先量
    lockBoost: 0.45     // 「最后一口气」的强度
  };

  AvatarRace.config = {
    TAU: TAU,
    LANE_SPEED: LANE_SPEED,
    CAR_W: CAR_W,
    CAR_LEN: CAR_LEN,
    MAX_OVERLAP: MAX_OVERLAP,
    LANES: LANES,
    LANE_STEP: LANE_STEP,
    LANE_MAX: LANE_MAX,
    HALF_W: HALF_W,
    RACE_DIST: RACE_DIST,
    FWD_RUNOFF: FWD_RUNOFF,
    VIEW_H: VIEW_H,
    MIN_VIEW_W: MIN_VIEW_W,
    PALETTE: PALETTE,
    RIG: RIG
  };
})(window);
