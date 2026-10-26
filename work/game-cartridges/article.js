const articleTabs = [...document.querySelectorAll('.article-tabs a')];
const articlePanels = articleTabs.map(tab => document.querySelector(tab.hash));

function showArticlePanel(index, focus = false) {
  articleTabs.forEach((tab, i) => {
    const selected = i === index;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    articlePanels[i].hidden = !selected;
    if (!selected) articlePanels[i].querySelectorAll('video').forEach(video => video.pause());
  });
  if (focus) articleTabs[index].focus();
}

document.querySelector('.article-tabs').setAttribute('role', 'tablist');
articleTabs.forEach((tab, index) => {
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', articlePanels[index].id);
  articlePanels[index].setAttribute('role', 'tabpanel');
  tab.addEventListener('click', event => {
    event.preventDefault();
    history.replaceState(null, '', tab.hash);
    showArticlePanel(index);
  });
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = 1 - index;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = articleTabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    history.replaceState(null, '', articleTabs[next].hash);
    showArticlePanel(next, true);
  });
});

function restoreArticlePanel() {
  const target = document.getElementById(location.hash.slice(1));
  const panel = target?.closest('.article-panel');
  showArticlePanel(Math.max(0, articlePanels.indexOf(panel)));
}
restoreArticlePanel();
addEventListener('hashchange', restoreArticlePanel);
