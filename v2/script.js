const navigation = document.querySelector('.video-tabs');
const tabs = [...navigation.querySelectorAll('a')];
const panels = tabs.map(tab => document.querySelector(tab.getAttribute('href')));

function selectVideo(index, focus = false) {
  tabs.forEach((tab, i) => {
    const selected = i === index;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    panels[i].hidden = !selected;
    // Unload hidden players so playback never continues behind another tab.
    if (!selected) {
      const player = panels[i].querySelector('.player');
      player.querySelector('iframe')?.remove();
      player.querySelector('.play').hidden = false;
    }
  });
  if (focus) tabs[index].focus();
}

navigation.setAttribute('role', 'tablist');
tabs.forEach((tab, index) => {
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', panels[index].id);
  panels[index].setAttribute('role', 'tabpanel');
  tab.addEventListener('click', event => {
    event.preventDefault();
    history.replaceState(null, '', tab.getAttribute('href'));
    selectVideo(index);
  });
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    history.replaceState(null, '', tabs[next].getAttribute('href'));
    selectVideo(next, true);
  });
});

function restoreVideo() {
  const index = panels.findIndex(panel => '#' + panel.id === location.hash);
  selectVideo(index < 0 ? 0 : index);
}
restoreVideo();
addEventListener('hashchange', restoreVideo);

document.querySelectorAll('.play').forEach(button => {
  button.addEventListener('click', event => {
    // Local files cannot send the HTTP referrer YouTube requires for embeds.
    if (!['http:', 'https:'].includes(location.protocol)) return;
    event.preventDefault();
    const player = button.closest('.player');
    const iframe = document.createElement('iframe');
    const url = new URL(`https://www.youtube-nocookie.com/embed/${player.dataset.video}`);
    url.search = new URLSearchParams({ autoplay: '1', rel: '0', origin: location.origin });
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.src = url.href;
    iframe.title = button.getAttribute('aria-label').replace(/^Play /, '');
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    button.hidden = true;
    player.append(iframe);
    iframe.focus();
  });
});
