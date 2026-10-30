import type { SkillBlueprintV5, SkillOperationBlueprintV5, SkillOperationRegistrationV5, SkillRegistrationV5, SkillRegistryDesignV5, SkillOutputBindingV5 } from './skill-runtime-v5';
import type { SkillContextViewV4, SkillResourceBindingV4 } from './skill-runtime-v4';
import type { RuntimeCoreVariantV6 } from './quality-creative-contracts-v6';

export type SkillContextViewV6 = SkillContextViewV4 | 'reader_prefix';
export type SkillOutputBindingV6 = SkillOutputBindingV5 | 'v6_adapter_required';

export type SkillOperationBlueprintV6 = Omit<SkillOperationBlueprintV5, 'outputBinding' | 'contextView'> & {
  outputBinding: SkillOutputBindingV6;
  contextView: SkillContextViewV6;
  runtimeCoreVariant: RuntimeCoreVariantV6;
  coreInstructionsOverride?: string;
};

export type SkillBlueprintV6 = Omit<SkillBlueprintV5, 'operations'> & {
  operations: SkillOperationBlueprintV6[];
};

export interface SkillCatalogBlueprintV6 {
  designVersion: 'V6';
  skills: SkillBlueprintV6[];
}

export type SkillOperationRegistrationV6 = Omit<SkillOperationRegistrationV5, 'provenanceBinding' | 'contextView'> & {
  provenanceBinding: SkillOutputBindingV6;
  contextView: SkillContextViewV6;
  runtimeCoreVariant: RuntimeCoreVariantV6;
  runtimeCoreResource: SkillResourceBindingV4;
  methodResource: SkillResourceBindingV4;
  methodSelection: 'skill_default' | 'operation_replacement';
  assemblyPolicyId: 'v6-single-core-method-operation';
};

export type SkillRegistrationV6 = Omit<SkillRegistrationV5, 'operations'> & {
  operations: SkillOperationRegistrationV6[];
};

export type SkillRegistryDesignV6 = Omit<SkillRegistryDesignV5, 'designVersion' | 'skills'> & {
  designVersion: 'V6';
  skills: SkillRegistrationV6[];
};
