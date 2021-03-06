const fs = require('fs')
const path = require('path')
const memored = require('memored'); // TODO: interprocess cache - can be used for synchronizing the attributes between processes
const lockFile = require('lockfile')
const attrFile = path.join(__dirname, '../../var/attributes.json')
const attrLockFile = path.join(__dirname, '../../var/attributes.json.lock')
const jsonFile = require('jsonfile')

let attrHash = {}

exports.getMap = () => {
    return attrHash
}


function mapToVS (attributeCode, attributeType, attributeValue) {
    return new Promise((resolve,reject) => {

        console.debug('Locking attributes file mutex')
        lockFile.lockSync(attrLockFile) // TODO: lock attributes per attribute not global lock - BUT then we need to ensure the attribute_id to be incremental
        try {
            attrHash = jsonFile.readFileSync(attrFile)
            console.debug('Attributes hash loaded', attrHash)
        } catch (err) {
            attrHash = {}
            console.log('Wrong attributes file format ', err.message)
        }


        let attr = attrHash[attributeCode]
        if (! attr) {
            let maxAttrId = Object.keys(attrHash).length + 1
            attr = attributeTemplate(attributeCode, attributeType)
            attr.id = maxAttrId
            attr.attribute_id = maxAttrId
            
            attrHash[attributeCode] = attr
            maxAttrId++
        } 
        if (attr.frontend_input == 'select') {
            let existingOption = attr.options.find((option) => { return option.label == attributeValue})
            if(!existingOption) {
                let lastOption = attr.options.length > 0 ? attr.options[attr.options.length-1] : null // we can use memored or elastic search to store each option per each attribute separately - to keep the same indexes between processes for example key would be: $attribute_code$$attribute_value = 14 
                                                                                                    // OR SEND MODIFIED attributes to the workers each time attrHash changes: https://nodejs.org/api/cluster.html#cluster_cluster_workers
                                                                                                    // OR WORK ON MUTEXES https://github.com/ttiny/mutex-node
                                                                                                    // OR WORK ON FILE LOCKS https://www.npmjs.com/package/lockfile
                let optIndex = 1
                if (lastOption) {
                    optIndex = lastOption.value + 1
                }
                attr.options.push({
                    label: attributeValue,
                    value: optIndex
                })
                jsonFile.writeFileSync(attrFile, attrHash, {spaces: 2})
                lockFile.unlockSync(attrLockFile)
                console.debug('Attributes file has been written and unlocked')
                resolve(optIndex)
            } else {
                jsonFile.writeFileSync(attrFile, attrHash, {spaces: 2})
                lockFile.unlockSync(attrLockFile)
                console.debug('Attributes file has been written and unlocked')
                resolve(existingOption.value) // non select attrs
            }


        } else {
            jsonFile.writeFileSync(attrFile, attrHash, {spaces: 2})
            lockFile.unlockSync(attrLockFile)
            console.debug('Attributes file has been written and unlocked')
            resolve(attributeValue)
            // we're fine here for decimal and varchar attributes
        }
    })
}


function mapElements(result, elements, locale = null) {
    let subpromises = []
    for(let attr of elements) {
        if(['multiselect', 'input', 'wysiwyg', 'numeric'].indexOf(attr.type) >= 0 && attr.value && (locale === null || attr.language == locale)) {
            subpromises.push(mapToVS(attr.name, attr.type, Array.isArray(attr.value) ? attr.value.join(', ') : attr.value).then((mappedValue) => {
                console.debug(` - attr ${attr.name} values: ${result.id} to ${attr.value}`)
                result[attr.name] = mappedValue
                console.debug(` - vs attr ${attr.name} values: ${result.id} to ${result[attr.name]}`)
            }))
        }
    } 
    return Promise.all(subpromises)
}

function attributeTemplate(attributeCode, attributeType = null) { // TODO: if we plan to support not full reindexes then we shall load the attribute templates from ES (previously filled up attrbutes)
    if(!fs.existsSync(path.join(__dirname, `../importers/templates/attribute_code_${attributeCode}.json`))) {
        console.debug(`Loading attribute by type ${attributeType}`)
        let attr = Object.assign({}, require(`../importers/templates/attribute_type_${attributeType}`))
        attr.attribute_code = attributeCode
        attr.default_frontend_label = attributeCode

        return attr
    }
    else {
        console.debug(`Loading attribute by code ${attributeCode}`) // in this case we have pretty damn good attribute meta in template, like name etc
        return require(`../importers/templates/attribute_code_${attributeCode}`)
    }
}

exports.attributeTemplate = attributeTemplate
/**
 * Vue storefront needs - like Magento - attribute dictionary to be populated by attr specifics; and here we are!
 * @param {String} attributeCode 
 * @param {String} attributeType 
 * @param {mixed} attributeValue 
 */
exports.mapToVS = mapToVS

exports.mapElements = mapElements