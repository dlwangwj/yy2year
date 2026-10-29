(function () {
  'use strict';

  // ---------- 状态 ----------
  let queue = [];        // 本轮待听写的单词
  let index = 0;         // 当前题号
  let correct = 0;       // 答对数
  let wrong = [];        // 本轮答错的单词
  let answered = false;  // 当前题是否已作答
  let typed = '';        // 当前题已输入的字母（只记字母，不含空格和标点）
  // 隐藏输入框里常驻的零宽空格，用于让 Android 键盘的删除键产生可检测的变化
  const SENTINEL = '​';

  const $ = (id) => document.getElementById(id);

  // ---------- 语音 ----------
  const hasSpeech = 'speechSynthesis' in window;
  let voice = null;

  function pickVoice() {
    if (!hasSpeech) return;
    const voices = speechSynthesis.getVoices();
    // 优先英式英语，其次任意英语
    voice = voices.find(v => /en[-_]GB/i.test(v.lang))
         || voices.find(v => /^en/i.test(v.lang))
         || null;
  }
  if (hasSpeech) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }

  function speak(text) {
    if (!hasSpeech) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice ? voice.lang : 'en-GB';
    if (voice) u.voice = voice;
    u.rate = parseFloat($('rate').value);
    speechSynthesis.speak(u);
  }

  // ---------- 选课 ----------
  // 按课号分组，课号升序
  const lessons = {};
  WORDS.forEach(w => {
    (lessons[w.lesson] = lessons[w.lesson] || []).push(w);
  });
  const lessonNos = Object.keys(lessons).map(Number).sort((a, b) => a - b);

  function renderLessons() {
    const list = $('lesson-list');
    list.innerHTML = '';
    lessonNos.forEach(no => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = no;
      cb.addEventListener('change', updateCount);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(`第${no}课 (${lessons[no].length})`));
      list.appendChild(label);
    });
    updateCount();
  }

  function selectedLessons() {
    return [...document.querySelectorAll('#lesson-list input:checked')]
      .map(cb => Number(cb.value));
  }

  function updateCount() {
    const sel = selectedLessons();
    const total = sel.reduce((n, no) => n + lessons[no].length, 0);
    $('selected-count').textContent = `已选 ${sel.length} 课，共 ${total} 词`;
  }

  $('select-all').addEventListener('click', () => {
    document.querySelectorAll('#lesson-list input').forEach(cb => cb.checked = true);
    updateCount();
  });
  $('select-none').addEventListener('click', () => {
    document.querySelectorAll('#lesson-list input').forEach(cb => cb.checked = false);
    updateCount();
  });

  // ---------- 听写流程 ----------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function show(id) {
    ['setup', 'quiz', 'result'].forEach(s => $(s).classList.toggle('hidden', s !== id));
  }

  function startQuiz(words) {
    if (!words.length) {
      $('setup-msg').textContent = '请先选择至少一课。';
      return;
    }
    $('setup-msg').textContent = '';
    queue = $('shuffle').checked ? shuffle(words) : words.slice();
    index = 0;
    correct = 0;
    wrong = [];
    show('quiz');
    showQuestion();
  }

  function showQuestion() {
    answered = false;
    typed = '';
    const w = queue[index];
    $('progress-text').textContent = `第 ${index + 1} / ${queue.length} 题`;
    $('score-text').textContent = `正确 ${correct}　错误 ${wrong.length}`;
    $('feedback').innerHTML = '';
    $('feedback').className = 'feedback';
    $('show-answer').classList.remove('hidden');
    $('next').classList.add('hidden');
    renderMask();
    focusTyper();
    speak(w.word);
  }

  // 桌面端直接聚焦隐藏输入框；手机端需要用户点击，见 word-mask 的 click 事件
  function focusTyper() {
    if (answered) return;
    const typer = $('typer');
    typer.value = SENTINEL;
    typer.focus({ preventScroll: true });
  }

  // 只统计字母；比较时忽略大小写、空格和标点
  function lettersOf(s) {
    return s.replace(/[^A-Za-z]/g, '').toLowerCase();
  }

  // 把单词渲染成下划线：字母位置显示已输入的字母或 "_"，空格和标点原样显示
  function renderMask() {
    const w = queue[index];
    const box = $('word-mask');
    box.innerHTML = '';
    let k = 0;
    [...w.word].forEach(c => {
      const span = document.createElement('span');
      if (/[A-Za-z]/.test(c)) {
        span.className = 'slot';
        if (k < typed.length) {
          span.textContent = typed[k];
          span.classList.add('filled');
        } else {
          span.textContent = '_';
        }
        k++;
      } else if (c === ' ') {
        span.className = 'gap';
        span.textContent = ' ';
      } else {
        span.className = 'punct';
        span.textContent = c;
      }
      box.appendChild(span);
    });
  }

  function submitAnswer() {
    if (answered) return;
    const w = queue[index];
    if (!typed) return;

    answered = true;
    $('show-answer').classList.add('hidden');

    if (typed === lettersOf(w.word)) {
      correct++;
      showFeedback(true, w, typed);
    } else {
      wrong.push(w);
      showFeedback(false, w, typed);
    }
    afterAnswer();
  }

  function showFeedback(ok, w, input) {
    const fb = $('feedback');
    fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
    const detail = `<div class="answer-word">${escapeHtml(w.word)}</div>`
      + (w.phonetic ? `<div>[${escapeHtml(w.phonetic)}]</div>` : '')
      + `<div class="meaning">${escapeHtml(w.meaning)}</div>`;
    if (ok) {
      fb.innerHTML = `<div>✔ 正确</div>${detail}`;
    } else {
      fb.innerHTML = `<div>✘ 你的答案：${escapeHtml(input || '（未作答）')}</div>${detail}`;
    }
  }

  function afterAnswer() {
    $('score-text').textContent = `正确 ${correct}　错误 ${wrong.length}`;
    $('next').classList.remove('hidden');
  }

  function nextQuestion() {
    index++;
    if (index >= queue.length) {
      showResult();
    } else {
      showQuestion();
    }
  }

  function showAnswer() {
    if (answered) return;
    const w = queue[index];
    answered = true;
    wrong.push(w);
    showFeedback(false, w, typed);
    afterAnswer();
  }

  function showResult() {
    show('result');
    // 中途结束时只统计已作答的题数
    const total = answered ? index + 1 : index;
    $('result-summary').textContent = `共 ${total} 题，正确 ${correct} 题，错误 ${wrong.length} 题。`;
    const ul = $('wrong-list');
    ul.innerHTML = '';
    if (!wrong.length) {
      ul.innerHTML = '<li>全部答对！</li>';
    }
    wrong.forEach(w => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${escapeHtml(w.word)}</strong>`
        + (w.phonetic ? ` <span class="wrong-meta">[${escapeHtml(w.phonetic)}]</span>` : '')
        + ` <span class="wrong-meta">第${w.lesson}课 · ${escapeHtml(w.meaning)}</span>`;
      ul.appendChild(li);
    });
    $('retry-wrong').classList.toggle('hidden', !wrong.length);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- 字母输入 ----------
  // 键盘和手机软键盘都通过 addLetter / removeLetter 修改 typed
  function addLetter(ch) {
    if (answered) return;
    const total = lettersOf(queue[index].word).length;
    if (typed.length < total) {
      typed += ch.toLowerCase();
      renderMask();
      // 字母数够了就自动提交
      if (typed.length === total) submitAnswer();
    }
  }

  function removeLetter() {
    if (answered) return;
    typed = typed.slice(0, -1);
    renderMask();
  }

  // 电脑键盘：直接监听 keydown
  document.addEventListener('keydown', (e) => {
    if ($('quiz').classList.contains('hidden')) return;
    // 焦点在按钮上时，回车交给按钮原生的点击处理，避免重复触发
    if (e.target.tagName === 'BUTTON' && e.key === 'Enter') return;
    // 焦点在隐藏输入框上时，由 typer 的 input 事件处理
    if (e.target === $('typer')) return;

    // 作答后按 Enter 进入下一题；作答前 Enter 不做任何事
    if (e.key === 'Enter') {
      e.preventDefault();
      if (answered) nextQuestion();
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      removeLetter();
      return;
    }

    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      addLetter(e.key);
    }
  });

  // 手机端：隐藏输入框接收软键盘输入
  // 输入框里常驻一个占位字符，这样 Android 键盘的删除键才会被识别为"删掉一个字符"
  const typer = $('typer');
  typer.value = SENTINEL;

  // 点击下划线区域时聚焦隐藏输入框，弹出软键盘
  $('word-mask').addEventListener('click', () => {
    if (!answered) focusTyper();
  });

  typer.addEventListener('input', (e) => {
    // 输入法组合中（Android 拼音/联想输入）不处理，等组合结束再取值
    if (e.isComposing) return;

    const value = typer.value;
    const hadSentinel = value.includes(SENTINEL);
    // 去掉占位符后的内容
    const body = value.replace(SENTINEL, '');

    if (!hadSentinel || body.length === 0) {
      // 占位符被删掉，或内容为空：按一次删除处理
      removeLetter();
    } else {
      [...body].forEach(ch => addLetter(ch));
    }
    typer.value = SENTINEL;
  });

  typer.addEventListener('compositionend', () => {
    // 组合输入结束后，把组合出的内容按字母录入
    const body = typer.value.replace(SENTINEL, '');
    typer.value = SENTINEL;
    [...body].forEach(ch => addLetter(ch));
  });

  // 删除键：部分浏览器不触发 beforeinput，统一在 keydown 里处理
  typer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (answered) nextQuestion();
      return;
    }
    if (e.key === 'Backspace' || e.keyCode === 8) {
      e.preventDefault();
      removeLetter();
      typer.value = SENTINEL;
    }
  });

  // ---------- 事件绑定 ----------
  $('start').addEventListener('click', () => {
    const sel = selectedLessons();
    const words = WORDS.filter(w => sel.includes(w.lesson));
    startQuiz(words);
  });

  $('replay').addEventListener('click', () => speak(queue[index].word));
  $('show-answer').addEventListener('click', showAnswer);
  $('next').addEventListener('click', nextQuestion);
  $('quit').addEventListener('click', () => {
    speechSynthesis && speechSynthesis.cancel();
    showResult();
  });
  $('retry-wrong').addEventListener('click', () => startQuiz(wrong.slice()));
  $('back-setup').addEventListener('click', () => {
    speechSynthesis && speechSynthesis.cancel();
    show('setup');
  });

  if (!hasSpeech) {
    $('setup-msg').textContent = '当前浏览器不支持语音朗读，请使用 Chrome 或 Edge。';
  }

  renderLessons();
})();
