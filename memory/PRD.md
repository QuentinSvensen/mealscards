# MealsCards — Product Requirements Document

## Problem Statement
Audit & refactoring complet du code de MealsCards, une application de gestion de repas, stock alimentaire, planning hebdomadaire et liste de courses.

## Architecture
- **Stack** : Vite + React 18 + TypeScript + Supabase + Tailwind CSS + shadcn/ui
- **Auth** : PIN-based via Supabase Edge Functions
- **Data** : Supabase (PostgreSQL) avec Real-time sync
- **Deployment** : Vercel-compatible, Capacitor pour mobile

## User Personas
- Utilisateur unique (app personnelle de gestion de repas/stock)

## Core Requirements
1. Gestion des aliments en stock (CRUD, catégorisation, compteurs d'ouverture)
2. Gestion des repas (catalogue, ingrédients, calories, protéines)
3. Planification hebdomadaire (drag & drop, totaux caloriques)
4. Liste de courses avec groupes et générateur de menu
5. Correspondance automatique stock ↔ recettes
6. Scanner de code-barres (Open Food Facts)
7. Chef IA (Gemini API) pour suggestions de recettes

## What's Been Implemented (2026-04-01)

### Refactoring DRY - Types unifiés
- **FoodItem type** : Source unique dans `hooks/useFoodItems.ts` (suppression de la duplication dans `FoodItems.tsx`)
- **Imports corrigés** : 12 fichiers mis à jour pour importer depuis `@/hooks/useFoodItems` au lieu de `@/components/FoodItems`
- **Import circulaire résolu** : `AIChefSuggestions.tsx` importait depuis le composant au lieu du hook
- **Fonctions dupliquées supprimées** : `formatNumeric`, `encodeStoredGrams`, `isExpiredDate` dans FoodItems.tsx remplacées par les imports de `ingredientUtils.ts`

### Bugs corrigés
- **Restauration stock (stale data)** : `restoreIngredientsToStock` mode 2 utilise maintenant des données fraîches Supabase au lieu du cache React périmé
- **Compteur optimiste désaligné** : `updatePlanning` optimistic update aligné avec la logique serveur (vérification stricte `!== null` vs `||` falsy)
- **Vite config** : Port corrigé (3000) et `allowedHosts: true` pour le preview

### data-testid ajoutés
- `pm-return-btn` sur PossibleMealCard (bouton retour)
- `meal-move-to-possible-btn` sur MealCard (bouton transfert)

## Prioritized Backlog

### P0 - Bugs restants à investiguer
- Compteurs des cartes lors de transferts complexes (nécessite tests avec données réelles)
- Consommation d'aliments lors du retour "au choix" (nécessite validation utilisateur)

### P1 - Refactoring à poursuivre
- Extraire le hook CRUD complet de FoodItems.tsx vers hooks/useFoodItems.ts (fusionner les deux hooks)
- Décomposer Index.tsx (1351 lignes) en sous-composants
- Décomposer WeeklyPlanning.tsx (2840 lignes) en sous-composants
- Ajouter data-testid exhaustifs sur tous les éléments interactifs

### P2 - Améliorations futures
- Tests unitaires pour la logique de stock (ingredientUtils, stockUtils)
- Supprimer les casts `as any` sur les appels Supabase (améliorer le typage)
- PWA offline-first avec meilleure gestion du cache
- Export/import des données pour backup

## Next Tasks
1. Validation utilisateur des corrections de compteur
2. Fusionner les deux hooks useFoodItems
3. Ajouter des tests de régression pour les transferts de stock
