let cleanup = null;

export const placeholderPuzzle = {
  generate(seed, difficulty) {
    return Object.freeze({ seed, difficulty });
  },

  mount(container, spec, { island, onSolve, onExit }) {
    this.unmount();
    container.replaceChildren();

    const shell = document.createElement('section');
    shell.className = 'placeholder-puzzle';
    shell.setAttribute('aria-labelledby', 'puzzle-island-name');

    const eyebrow = document.createElement('span');
    eyebrow.className = 'placeholder-puzzle__eyebrow';
    eyebrow.textContent = 'BEYAZ ODA · DENEME BULMACASI';

    const title = document.createElement('h1');
    title.id = 'puzzle-island-name';
    title.textContent = island.name;

    const difficulty = document.createElement('p');
    difficulty.className = 'placeholder-puzzle__difficulty';
    difficulty.textContent = `Zorluk ${island.difficulty} / 5`;

    const note = document.createElement('p');
    note.className = 'placeholder-puzzle__note';
    note.textContent = `Bu oda CP2 için işlevsel bir kabuktur. Tohum: ${spec.seed}`;

    const actions = document.createElement('div');
    actions.className = 'placeholder-puzzle__actions';
    const solveButton = createButton('Çöz', 'puzzle-button puzzle-button--solve');
    const exitButton = createButton('Geri', 'puzzle-button puzzle-button--back');
    actions.append(solveButton, exitButton);
    shell.append(eyebrow, title, difficulty, note, actions);
    container.append(shell);

    let solved = false;
    const handleSolve = () => {
      if (solved) return;
      solved = true;
      solveButton.disabled = true;
      onSolve();
    };
    const handleExit = () => onExit();
    solveButton.addEventListener('click', handleSolve);
    exitButton.addEventListener('click', handleExit);
    cleanup = () => {
      solveButton.removeEventListener('click', handleSolve);
      exitButton.removeEventListener('click', handleExit);
      container.replaceChildren();
      cleanup = null;
    };
    solveButton.focus({ preventScroll: true });
  },

  unmount() {
    cleanup?.();
  },
};

function createButton(label, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}
