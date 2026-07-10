;(function expose(factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    window.EmperorPetIdleScenes = factory()
  }
})(function buildIdleScenes() {
  const IDLE_BUBBLE_INTERVAL_MS = 25000
  const IDLE_BUBBLE_DURATION_MS = 6000
  const IDLE_SLEEP_DURATION_MS = 8000

  const IDLE_SCENES = [
    { animation: 'idle', theme: 'watch' },
    { animation: 'sweeping', theme: 'tidy' },
    { animation: 'idle', theme: 'patrol' },
    { animation: 'sweeping', theme: 'tidy' },
    { animation: 'idle', theme: 'ready' },
    { animation: 'sweeping', theme: 'tidy' },
    {
      animation: 'sleeping',
      theme: 'nap',
      durationMs: IDLE_SLEEP_DURATION_MS,
      wakeAnimation: 'idle',
    },
  ]

  const IDLE_BANTER = [
    '我在，等下一道旨意。',
    '主人若歇一会儿，我先守着。',
    '门口风声正常，案头也安静。',
    '灯还亮着，我也还醒着。',
    '有事喊一声，我立刻蹦起来。',
    '今日值守中，精神头还足。',
    '我巡一圈，看看有没有新动静。',
    '四下平稳，没有急件闯进来。',
    '我把耳朵竖着，等主人开口。',
    '窗外无事，屏上待命。',
    '小小巡逻一下，免得灵感溜走。',
    '案边守候，随时接旨。',
    '把案头扫一扫，等会儿好开工。',
    '清清缓存般的心情，准备下一轮。',
    '我先整理一下桌面气场。',
    '尘埃归位，思路也归位。',
    '把零碎念头扫成一小堆。',
    '工具箱擦亮了，等主人挑一件。',
    '闲时也盘一盘线索。',
    '我在脑内排了排队形。',
    '先把可能路线默默过一遍。',
    '灵感先放温，等会儿正好入口。',
    '没有任务时，也可以磨磨判断力。',
    '线索架子摆好了，下一问就能取。',
    '今日精神不错，随时能上阵。',
    '风平浪静，也挺适合蓄力。',
    '我先高兴三秒，等会儿继续干活。',
    '状态良好，尾巴都想打拍子。',
    '没事也挺好，说明系统安稳。',
    '我在这儿，陪主人把事情慢慢捋顺。',
    '有新旨意，喊我一声就到。',
    '若有要紧事，我会立刻亮灯。',
    '我把提醒牌放在手边了。',
    '下一条消息来时，我会先接住。',
    '小憩八息，耳朵还醒着。',
    '眯一下，不离岗。',
    '打个短盹，马上回来值守。',
    '先闭眼数到八，再继续巡逻。',
  ]

  function idleSceneAt(index) {
    const safeIndex = Math.max(0, Number(index) || 0)
    const scene = IDLE_SCENES[safeIndex % IDLE_SCENES.length]
    const bubble = IDLE_BANTER[safeIndex % IDLE_BANTER.length]
    return {
      ...scene,
      bubble,
      bubbleDurationMs: IDLE_BUBBLE_DURATION_MS,
    }
  }

  return {
    IDLE_BANTER,
    IDLE_BUBBLE_DURATION_MS,
    IDLE_BUBBLE_INTERVAL_MS,
    IDLE_SCENES,
    IDLE_SLEEP_DURATION_MS,
    idleSceneAt,
  }
})
