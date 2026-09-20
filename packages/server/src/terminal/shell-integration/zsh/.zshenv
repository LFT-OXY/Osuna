typeset -g OSUNA_SHELL_INTEGRATION_DIR="${${(%):-%N}:A:h}"

if [[ -n "${OSUNA_ZSH_ZDOTDIR-}" ]]; then
  export ZDOTDIR="${OSUNA_ZSH_ZDOTDIR}"
else
  unset ZDOTDIR
fi

if [[ -n "${ZDOTDIR-}" ]]; then
  if [[ -f "${ZDOTDIR}/.zshenv" ]]; then
    source "${ZDOTDIR}/.zshenv"
  fi
elif [[ -f "${HOME}/.zshenv" ]]; then
  source "${HOME}/.zshenv"
fi

source "${OSUNA_SHELL_INTEGRATION_DIR}/paseo-integration.zsh"
