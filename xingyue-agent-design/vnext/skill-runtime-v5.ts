import type { SkillBlueprintV4, SkillOperationBlueprintV4, SkillOperationRegistrationV4, SkillRegistrationV4, SkillRegistryDesignV4, SkillOutputBindingV4 } from './skill-runtime-v4';

export type SkillOutputBindingV5 = SkillOutputBindingV4 | 'v5_adapter_required';

export interface SkillTargetBindingV5 {
  targetKind: 'entity_name' | 'book_title' | 'blurb';
  additionalInputKinds: string[];
  additionalValidators: string[];
}

export type SkillOperationBlueprintV5 = Omit<SkillOperationBlueprintV4, 'outputBinding'> & {
  outputBinding: SkillOutputBindingV5;
  targetBindings?: SkillTargetBindingV5[];
};

export type SkillBlueprintV5 = Omit<SkillBlueprintV4, 'operations'> & {
  operations: SkillOperationBlueprintV5[];
};

export interface SkillCatalogBlueprintV5 {
  designVersion: 'V5';
  skills: SkillBlueprintV5[];
}

export type SkillOperationRegistrationV5 = Omit<SkillOperationRegistrationV4, 'provenanceBinding'> & {
  provenanceBinding: SkillOutputBindingV5;
};

export type SkillRegistrationV5 = Omit<SkillRegistrationV4, 'operations'> & {
  operations: SkillOperationRegistrationV5[];
};

export type SkillRegistryDesignV5 = Omit<SkillRegistryDesignV4, 'designVersion' | 'skills'> & {
  designVersion: 'V5';
  skills: SkillRegistrationV5[];
};
