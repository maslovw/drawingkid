// "Grown-ups only" check before Settings: a small multiplication that adults answer
// instantly but young children can't. Answers are three buttons (no keyboard);
// the wrong ones are near misses so they can't be ruled out by size alone.

export class ParentGate {
  constructor(dialog) {
    this.dialog = dialog;
    this.question = dialog.querySelector('#gate-question');
    this.choices = dialog.querySelector('#gate-choices');
    this.hint = dialog.querySelector('#gate-hint');
    this.resolve = null;

    this.choices.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      if (Number(button.dataset.value) === this.expected) {
        this.#finish(true);
      } else {
        this.hint.textContent = 'Not quite. Try this one.';
        this.dialog.classList.remove('shake');
        void this.dialog.offsetWidth; // restart the animation
        this.dialog.classList.add('shake');
        this.#newQuestion();
      }
    });
    dialog.querySelector('#gate-form').addEventListener('submit', (e) => e.preventDefault());
    dialog.querySelector('#gate-cancel').addEventListener('click', () => this.#finish(false));
    dialog.addEventListener('close', () => this.#finish(false));
  }

  // Resolves true once the right answer is picked, false if cancelled.
  ask() {
    this.hint.textContent = '';
    this.#newQuestion();
    this.dialog.showModal();
    return new Promise((resolve) => (this.resolve = resolve));
  }

  #newQuestion() {
    const n = () => 3 + Math.floor(Math.random() * 7); // 3..9
    const a = n();
    const b = n();
    this.expected = a * b;
    this.question.textContent = `${a} × ${b} = ?`;

    const nearMisses = [...new Set([a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b])]
      .filter((v) => v !== this.expected);
    shuffle(nearMisses);
    const answers = shuffle([this.expected, ...nearMisses.slice(0, 2)]);

    this.choices.replaceChildren(
      ...answers.map((value) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.value = value;
        button.textContent = value;
        return button;
      }),
    );
  }

  #finish(ok) {
    const resolve = this.resolve;
    this.resolve = null;
    if (this.dialog.open) this.dialog.close();
    resolve?.(ok);
  }
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
