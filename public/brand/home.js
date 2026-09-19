const image = document.querySelector('#city-image');
const title = document.querySelector('#scene-title');
const description = document.querySelector('#scene-description');
const scenes = {
  day: ['钟楼下，故事刚刚开始。', '沿着林荫街道，遇见下一种可能。', '游戏内实际渲染的日光街区：钟楼、连续街屋与林荫道路'],
  night: ['入夜后，城市亮起另一面。', '灯火沿街铺开，给晚归的人留一扇窗。', '游戏内实际渲染的夜间街区：钟楼和街屋亮起温暖窗光']
};
let requestedScene = 'day';
for (const button of document.querySelectorAll('[data-scene]')) {
  button.addEventListener('click', () => {
    const scene = button.dataset.scene;
    requestedScene = scene;
    const next = new Image();
    next.onload = () => {
      if (requestedScene !== scene) return;
      image.src = next.src;
      image.alt = scenes[scene][2];
      title.textContent = scenes[scene][0];
      description.textContent = scenes[scene][1];
      for (const item of document.querySelectorAll('[data-scene]')) item.setAttribute('aria-pressed', String(item === button));
    };
    next.src = `/brand/city-${scene}.jpg`;
  });
}

const landmark = document.querySelector('.landmark-pin');
landmark?.addEventListener('click', () => {
  const expanded = landmark.getAttribute('aria-expanded') !== 'true';
  landmark.setAttribute('aria-expanded', String(expanded));
  document.querySelector('.note-default').hidden = expanded;
  document.querySelector('.note-landmark').hidden = !expanded;
  if (expanded && matchMedia('(max-width: 700px)').matches) {
    document.querySelector('#landmark-note').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
  }
});
