import fs from "fs";
import path from "path";

import {
    path_pattern,
    ref_pattern,
    whitespace_pattern,
    var_pattern,
    template_name_pattern,
    template_ref_pattern,
    settings,
    resolveVars
} from './utils.js';

// feature dictionary
export let features = new Map();
// template dictionary
let templates = new Map();
// list of feature identifiers
export let featureList = new Set();

export function createFeature(namespace, name, object, vars={}){
    for (let prop in object){
        if (var_pattern.test(prop)){
            if (!(prop in vars)) {
                vars[prop] = object[prop];
            }
            delete object[prop];
        }
    }

    // template vars can't be resolved until instantiation
    if (template_name_pattern.test(name)){
        return new FeatureTemplate(namespace, name, object, vars);
    }

    object = resolveVars(object, vars, `${namespace}.${name}`);

    if ("inherits" in object){
        //return new TemplateInstance(namespace, name, object, vars);
        const match = object.inherits.match(template_ref_pattern);
        const template_namespace = match[2] ? match[2] : namespace;
        const template_name = match[3];
        let template = `${settings.project_namespace}:${template_namespace}${settings.namespaced_subfolders ? "/" : "_"}${template_name}`;

        if (templates.has(template)){
            console.log(templates.get(template).object);
            return createFeature(namespace, name, structuredClone(templates.get(template).object), {...templates.get(template).vars, ...vars});
        } else {
            throw new Error(`Template, ${template_namespace}.${template_name}, not found`);
        }
    }
    
    switch (object.type){
    case "rule":
        return new FeatureRule(namespace, name, object, vars);
    case "aggregate":
        return new AggregateFeature(namespace, name, object, vars);
    case "block":
        return new BlockFeature(namespace, name, object, vars);
    case "conditional_list":
        return new ConditionalListFeature(namespace, name, object, vars);
    case "geode":
        return new GeodeFeature(namespace, name, object, vars);
    case "growing_plant":
        return new GrowingPlantFeature(namespace, name, object, vars);
    case "ore":
        return new OreFeature(namespace, name, object, vars);
    case "scatter":
        return new ScatterFeature(namespace, name, object, vars);
    case "search":
        return new SearchFeature(namespace, name, object, vars);
    case "structure":
        return new StructureFeature(namespace, name, object, vars);
    case "surface_snap":
        return new SurfaceSnapFeature(namespace, name, object, vars);
    case "vegetation_patch":
        return new VegetationPatchFeature(namespace, name, object, vars);
    case "weighted_random":
        return new WeightedRandomFeature(namespace, name, object, vars);
    default:
        throw new Error(`Feature type "${object.type}" does not exist.`);
    }
}

class FeatureTemplate {
    constructor(namespace, name, object, vars){
        this.namespace = namespace;
        this.name = name;
        this.object = object;
        this.identifier = `${settings.project_namespace}:${namespace}${settings.namespaced_subfolders ? "/" : "_"}${name}`;
        this.type = "template";
        this.vars = vars;

        if (templates.has(this.identifier)){
            throw new Error(`Duplicate template, ${this.identifier}`);
        } else {
            templates.set(this.identifier, this);
        }
    }
}

class Feature {
    constructor(namespace, name, object, vars){
        this.namespace = namespace;
        this.name = name;
        this.object = object;
        this.path = `${settings.features_directory}/${namespace}${settings.namespaced_subfolders ? "/" : "_"}${name}.json`;
        this.identifier = `${settings.project_namespace}:${namespace}${settings.namespaced_subfolders ? "/" : "_"}${name}`;

        this.vars = vars;

        if (featureList.has(this.identifier)) {
            throw new Error(`Duplicate feature in registry, ${this.identifier}`);
        } else {
            featureList.add(this.identifier);
        }

        if (features.has(this.identifier)){
            throw new Error(`Duplicate feature, ${this.identifier}`);
        } else {
            features.set(this.identifier, this);
        }
    }

    // returns the identifier of a feature reference
    normalizeReference(ref, vars, index=0) {
        if (typeof ref === "string") {
            let identifier;
            if (!path_pattern.test(ref)) {
                const match = ref.match(ref_pattern);
                if (match) {
                    const [, , ref_namespace, ref_name] = match;
                    identifier = `${settings.project_namespace}:${ref_namespace ? ref_namespace : this.namespace}${settings.namespaced_subfolders ? "/" : "_"}${ref_name}`;
                } else {
                    throw new Error(`Invalid feature reference: ${ref}`);
                }
                if (!featureList.has(identifier)) {
                    throw new Error(`Feature ${identifier} not found.`);
                }
            } else {
                identifier = ref;
                if (!featureList.has(identifier)) {
                    console.warn(`Feature ${identifier} not found locally. This feature may not exist.`);
                }
            }

            return identifier;
        } else {
            let child = createFeature(this.namespace, `${this.name}_${index}`, ref, vars);
            return child.identifier;
        }
    }

    writeFeature() {
        if (fs.existsSync(this.path)){
            throw new Error(`File Conflict: "${this.path}" already exists`);
        }

        fs.mkdirSync(path.dirname(this.path), { recursive: true });
        
        fs.writeFileSync(this.path, JSON.stringify(this.flatten(), (_, value) => {
            if (typeof value === "string") {
                return value.replaceAll(whitespace_pattern, " ");
            }
            return value;
        }, 4));
    }
}

class FeatureRule extends Feature {
    constructor(namespace, name, object, vars){
        super(namespace, name, object, vars);
        this.path = `${settings.feature_rules_directory}/${namespace}${settings.namespaced_subfolders ? `/${namespace}_` : "_"}${name}.json`;
        this.identifier = `${settings.project_namespace}:${namespace}_${name}`;
        this.type = "rule";
    }

    resolve(vars){
        vars = {...this.vars, ...vars};
        this.object.places = this.normalizeReference(this.object.places, vars);
    }

    flatten(){
        let feature = this.object;
        feature.description = {
            identifier: this.identifier,
            places_feature: feature.places
        };
        delete feature.type;
        delete feature.places;

        return {
            format_version: "1.13.0",
            "minecraft:feature_rules": feature
        };
    }
}

class AggregateFeature extends Feature {
    constructor(namespace, name, object){
        super(namespace, name, object);
        this.type = "weighted_random";
    }

    resolve(vars){
        vars = {...this.vars, ...vars};
        for (let i = 0; i < this.object.places.length; i++){
            this.object.places[i] = this.normalizeReference(this.object.places[i], vars, i);
        }
    }

    flatten(){
        let feature = this.object;
        feature.features = feature.places;
        feature.description = {
            identifier: this.identifier
        };
        delete feature.type;
        delete feature.places;

        return {
            format_version: "1.13.0",
            "minecraft:aggregate_feature": feature
        };
    }
}

class BlockFeature extends Feature {
    constructor(namespace, name, object){
        super(namespace, name, object);
        this.type = "block";
    }

    resolve(vars){}
    
    flatten(){
        let feature = this.object;
        feature.description = {
            identifier: this.identifier
        };
        delete feature.type;

        return {
            format_version: "1.13.0",
            "minecraft:single_block_feature": feature
        };
    }
}

class ConditionalListFeature extends Feature {
    constructor(namespace, name, object){
        super(namespace, name, object);
        this.type = "conditional_list";
    }

    resolve(vars){
        vars = {...this.vars, ...vars};
        for (let i = 0; i < this.object.places.length; i++){
            let [ref, condition] = this.object.places[i];
            const wrapper = {
                type: "scatter",
                places: ref,
                distribution: {
                    iterations: condition,
                    x: 0,
                    y: 0,
                    z: 0
                }
            }
            this.object.places[i] = this.normalizeReference(wrapper, vars, i);
        }
    }
    
    flatten(){
        let feature = this.object;
        feature.features = feature.places;;
        feature.description = {
            identifier: this.identifier
        };
        delete feature.type;
        delete feature.places;

        return {
            format_version: "1.13.0",
            "minecraft:aggregate_feature": feature
        };
    }
}

class GeodeFeature extends Feature {
    constructor(namespace, name, object){
        super(namespace, name, object);
        this.type = "geode";
    }

    resolve(vars){}
    
    flatten(){
        let feature = this.object;
        feature.description = {
            identifier: this.identifier
        };
        delete feature.type;

        return {
            format_version: "1.13.0",
            "minecraft:geode_feature": feature
        };
    }
}

class GrowingPlantFeature extends Feature {
    constructor(namespace, name, object){
        super(namespace, name, object);
        this.type = "growing_plant";
    }

    resolve(vars){}
    
    flatten(){
        let feature = this.object;
        feature.description = {
            identifier: this.identifier
        };
        delete feature.type;

        return {
            format_version: "1.13.0",
            "minecraft:growing_plant_feature": feature
        };
    }
  }

class OreFeature extends Feature {
    constructor(namespace, name, object){
        super(namespace, name, object);
        this.type = "ore";
    }

    resolve(vars){}
    
    flatten(){
        let feature = this.object;
        feature.description = {
            identifier: this.identifier
        };
        delete feature.type;

        return {
            format_version: "1.13.0",
            "minecraft:ore_feature": feature
        };
    }
  }

class ScatterFeature extends Feature {
    constructor(namespace, name, object){
        super(namespace, name, object);
        this.type = "scatter";
    }

    resolve(vars){
        vars = {...this.vars, ...vars};
        this.object.places = this.normalizeReference(this.object.places, vars);
    }
    
    flatten(){
        let feature = this.object;
        feature.places_feature = feature.places;
        feature.description = {
            identifier: this.identifier
        };
        feature = structuredClone({...feature, ...feature.distribution});
        delete feature.distribution;
        delete feature.type;
        delete feature.places;

        return {
            format_version: "1.13.0",
            "minecraft:scatter_feature": feature
        };
    }
}

class SearchFeature extends Feature {
    constructor(namespace, name, object){
        super(namespace, name, object);
        this.type = "search";
    }

    resolve(vars){
        vars = {...this.vars, ...vars};
        this.object.places = this.normalizeReference(this.object.places, vars);
    }
    
    flatten(){
        let feature = this.object;
        feature.places_feature = feature.places;
        feature.description = {
            identifier: this.identifier
        };
        delete feature.type;
        delete feature.places;

        return {
            format_version: "1.13.0",
            "minecraft:search_feature": feature
        };
    }
}

class StructureFeature extends Feature {
    constructor(namespace, name, object){
        super(namespace, name, object);
        this.type = "structure";
    }

    resolve(vars){}
    
    flatten(){
        let feature = this.object;
        feature.structure_name = feature.places_structure;
        feature.description = {
            identifier: this.identifier
        };
        delete feature.places_structure;
        delete feature.type;

        return {
            format_version: "1.13.0",
            "minecraft:structure_template_feature": feature
        };
    }
}

class SurfaceSnapFeature extends Feature {
    constructor(namespace, name, object){
        super(namespace, name, object);
        this.type = "surface_snap";
    }

    resolve(vars){
        vars = {...this.vars, ...vars};
        this.object.places = this.normalizeReference(this.object.places, vars);
    }
    
    flatten(){
        let feature = this.object;
        feature.feature_to_snap = feature.places;
        feature.description = {
            identifier: this.identifier
        };
        delete feature.type;
        delete feature.places;

        return {
            format_version: "1.13.0",
            "minecraft:snap_to_surface_feature": feature
        };
    }
}

class VegetationPatchFeature extends Feature {
    constructor(namespace, name, object){
        super(namespace, name, object);
        this.type = "vegetation_patch";
    }

    resolve(vars){
        vars = {...this.vars, ...vars};
        this.object.places = this.normalizeReference(this.object.places, vars);
    }
    
    flatten(){
        let feature = this.object;
        feature.vegetation_feature = feature.places;
        feature.description = {
            identifier: this.identifier
        };
        delete feature.type;
        delete feature.places;

        return {
            format_version: "1.13.0",
            "minecraft:vegetation_patch_feature": feature
        };
    }
}

class WeightedRandomFeature extends Feature {
    constructor(namespace, name, object){
        super(namespace, name, object);
        this.type = "weighted_random";
    }

    resolve(vars){
        vars = {...this.vars, ...vars};
        for (let i = 0; i < this.object.places.length; i++){
            this.object.places[i][0] = this.normalizeReference(this.object.places[i][0], vars, i);
        }
    }

    flatten(){
        let feature = this.object;
        feature.features = feature.places;;
        feature.description = {
            identifier: this.identifier
        };
        delete feature.type;
        delete feature.places;

        return {
            format_version: "1.13.0",
            "minecraft:weighted_random_feature": feature
        };
    }
}