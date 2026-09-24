// "Grown-ups only" check before Settings: a small multiplication that adults answer
// instantly but young children can't.

export class ParentGate {
  constructor(dialog) {
    this.dialog = dialog;
    this.question = dialog.querySelector('#gate-question');
    this.answer = dialog.querySelector('#gate-answer');
    this.hint = dialog.querySelector('#gate-hint');
    this.resolve = null;

    dialog.querySelector('#gate-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (Number(this.answer.value) === this.expected) {
        this.#finish(true);
      } else {
        this.hint.textContent = 'Not quite. Try this one.';
        this.dialog.classList.remove('shake');
        void this.dialog.offsetWidth; // restart the animation
        this.dialog.classList.add('shake');
        this.#newQuestion();
      }
    });
    dialog.querySelector('#gate-cancel').addEventListener('click', () => this.#finish(false));
    dialog.addEventListener('close', () => this.#finish(false));
  }

  // Resolves true once the right answer is given, false if cancelled.
  ask() {
    this.hint.textContent = '';
    this.#newQuestion();
    this.dialog.showModal();
    this.answer.focus();
    return new Promise((resolve) => (this.resolve = resolve));
  }

  #newQuestion() {
    const n = () => 3 + Math.floor(Math.random() * 7); // 3..9
    const a = n();
    const b = n();
    this.expected = a * b;
    this.question.textContent = `${a} × ${b} = ?`;
    this.answer.value = '';
  }

  #finish(ok) {
    const resolve = this.resolve;
    this.resolve = null;
    if (this.dialog.open) this.dialog.close();
    resolve?.(ok);
  }
}
