#!/bin/bash
# =============================================================================
# Alpha Print - Script de Release Automatico
# =============================================================================
# Uso: bash scripts/release.sh [patch|minor|major]
# Padrao: patch (1.0.1 -> 1.0.2)
#
# O que este script faz:
# 1. Incrementa a versao no package.json (patch/minor/major)
# 2. Faz commit da mudanca de versao
# 3. Cria tag git (v1.0.2)
# 4. Faz push do commit + tag pro GitHub
# 5. O GitHub Actions (.github/workflows/release.yml) faz o resto:
#    - Build do .exe
#    - Cria GitHub Release com o instalador
#    - O site ja aponta pra /releases/latest/ automaticamente
# =============================================================================

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

BUMP_TYPE="${1:-patch}"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  Alpha Print - Release Automatico${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# Validar tipo de bump
if [[ "$BUMP_TYPE" != "patch" && "$BUMP_TYPE" != "minor" && "$BUMP_TYPE" != "major" ]]; then
    echo -e "${RED}Erro: Tipo invalido '$BUMP_TYPE'. Use: patch, minor ou major${NC}"
    exit 1
fi

# Verificar se estamos no branch main
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "main" ]]; then
    echo -e "${RED}Erro: Voce precisa estar no branch 'main'. Branch atual: $BRANCH${NC}"
    exit 1
fi

# Verificar se tem mudancas nao commitadas
if [[ -n $(git status --porcelain) ]]; then
    echo -e "${RED}Erro: Tem mudancas nao commitadas. Commit ou stash antes de fazer release.${NC}"
    git status --short
    exit 1
fi

# Puxar mudancas mais recentes
echo -e "${GREEN}Puxando mudancas mais recentes...${NC}"
git pull origin main

# Pegar versao atual
OLD_VERSION=$(node -p "require('./package.json').version")
echo -e "Versao atual: ${YELLOW}$OLD_VERSION${NC}"

# Incrementar versao (sem o prebuild automatico)
echo -e "${GREEN}Incrementando versao ($BUMP_TYPE)...${NC}"
npm version "$BUMP_TYPE" --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
echo -e "Nova versao: ${GREEN}$NEW_VERSION${NC}"

# Commit da mudanca de versao
echo -e "${GREEN}Commitando mudanca de versao...${NC}"
git add package.json package-lock.json 2>/dev/null || git add package.json
git commit -m "release: v$NEW_VERSION"

# Criar tag
echo -e "${GREEN}Criando tag v$NEW_VERSION...${NC}"
git tag "v$NEW_VERSION"

# Push
echo -e "${GREEN}Enviando pro GitHub...${NC}"
git push origin main
git push origin "v$NEW_VERSION"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Release v$NEW_VERSION iniciado!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "O GitHub Actions vai agora:"
echo -e "  1. Buildar o Alpha Print"
echo -e "  2. Criar o instalador .exe"
echo -e "  3. Publicar no GitHub Releases"
echo -e ""
echo -e "O site ja aponta pra versao mais recente automaticamente."
echo -e ""
echo -e "Acompanhe: ${YELLOW}https://github.com/jefteamaral1996/alpha-print/actions${NC}"
echo -e "Release:   ${YELLOW}https://github.com/jefteamaral1996/alpha-print/releases/tag/v$NEW_VERSION${NC}"
