import React from 'react';
import PropTypes from 'prop-types';
import { gql, useMutation, useQuery } from '@apollo/client';
import { useFormik } from 'formik';
import { filter, get, isEmpty, omit, size } from 'lodash';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

import { MODERATION_CATEGORIES } from '../../../lib/constants/moderation-categories';
import { API_V2_CONTEXT, gqlV2 } from '../../../lib/graphql/helpers';
import { omitDeep, stripHTML } from '../../../lib/utils';

import Container from '../../Container';
import { Flex } from '../../Grid';
import MessageBox from '../../MessageBox';
import MessageBoxGraphqlError from '../../MessageBoxGraphqlError';
import RichTextEditor from '../../RichTextEditor';
import StyledButton from '../../StyledButton';
import StyledCheckbox from '../../StyledCheckbox';
import StyledInputField from '../../StyledInputField';
import StyledSelect from '../../StyledSelect';
import { P } from '../../Text';
import { TOAST_TYPE, useToasts } from '../../ToastProvider';

import { getSettingsQuery } from './EditCollectivePage';
import SettingsSectionTitle from './SettingsSectionTitle';

const EXPENSE_POLICY_MAX_LENGTH = 16000; // max in database is ~15,500
const CONTRIBUTION_POLICY_MAX_LENGTH = 3000; // 600 words * 5 characters average length word

const updateFilterCategoriesMutation = gqlV2/* GraphQL */ `
  mutation UpdateFilterCategories($account: AccountReferenceInput!, $key: AccountSettingsKey!, $value: JSON!) {
    editAccountSetting(account: $account, key: $key, value: $value) {
      id
      type
      isActive
      settings
    }
  }
`;

const editCollectiveMutation = gql/* GraphQL */ `
  mutation EditCollectiveMutation($collective: CollectiveInputType!) {
    editCollective(collective: $collective) {
      id
      type
      isActive
      settings
    }
  }
`;

const setPoliciesMutation = gqlV2/* GraphQL */ `
  mutation SetPolicies($account: AccountReferenceInput!, $policies: JSON!) {
    setPolicies(account: $account, policies: $policies) {
      id
      policies {
        EXPENSE_AUTHOR_CANNOT_APPROVE
        COLLECTIVE_MINIMUM_ADMINS {
          numberOfAdmins
          applies
          freeze
        }
      }
    }
  }
`;

const messages = defineMessages({
  'rejectCategories.placeholder': {
    id: 'editCollective.rejectCategories.placeholder',
    defaultMessage: 'Choose categories',
  },
  'contributionPolicy.label': {
    id: 'collective.contributionPolicy.label',
    defaultMessage: 'Contribution Policy',
  },
  'contributionPolicy.placeholder': {
    id: 'collective.contributionPolicy.placeholder',
    defaultMessage: 'E.g. what types of contributions you will and will not accept.',
  },
  'contributionPolicy.error': {
    id: 'collective.contributionPolicy.error',
    defaultMessage: 'Contribution policy must contain less than {maxLength} characters',
  },
  'expensePolicy.label': {
    id: 'editCollective.menu.expenses',
    defaultMessage: 'Expenses Policy',
  },
  'expensePolicy.placeholder': {
    id: 'collective.expensePolicy.placeholder',
    defaultMessage: 'E.g. approval criteria, limitations, or required documentation.',
  },
  'expensePolicy.error': {
    id: 'collective.expensePolicy.error',
    defaultMessage: 'Expense policy must contain less than {maxLength} characters',
  },
  'expensePolicy.allowExpense': {
    id: 'collective.expensePolicy.allowExpense',
    defaultMessage:
      'Only allow expenses to be created by Team Members and Financial Contributors (they may invite expenses from other payees)',
  },
  'requiredAdmins.numberOfAdmins': {
    defaultMessage: '{admins, plural, =0 {Do not enforce minimum number of admins} one {# Admin} other {# Admins} }',
  },
});

const Policies = ({ collective, showOnlyExpensePolicy }) => {
  const { formatMessage } = useIntl();
  const [selected, setSelected] = React.useState([]);
  const { addToast } = useToasts();

  // GraphQL
  const { loading, data } = useQuery(getSettingsQuery, {
    variables: { slug: collective.slug },
    context: API_V2_CONTEXT,
  });
  const [updateCategories, { loading: isSubmittingCategories, error: categoriesError }] = useMutation(
    updateFilterCategoriesMutation,
    {
      context: API_V2_CONTEXT,
    },
  );
  const [updateCollective, { loading: isSubmittingSettings, error: settingsError }] =
    useMutation(editCollectiveMutation);
  const [setPolicies, { loading: isSettingPolicies, error: policiesError }] = useMutation(setPoliciesMutation, {
    context: API_V2_CONTEXT,
  });
  const error = categoriesError || settingsError || policiesError;

  // Data and data handling
  const collectiveContributionFilteringCategories = get(data, 'account.settings.moderation.rejectedCategories', null);
  const collectiveContributionPolicy = get(collective, 'contributionPolicy', null);
  const collectiveExpensePolicy = get(collective, 'expensePolicy', null);
  const collectiveDisableExpenseSubmission = get(collective, 'settings.disablePublicExpenseSubmission', false);
  const numberOfAdmins = size(filter(collective.members, m => m.role === 'ADMIN'));

  const selectOptions = React.useMemo(() => {
    const optionsArray = Object.entries(MODERATION_CATEGORIES).map(([key, value], index) => ({
      id: index,
      value: key,
      label: value,
    }));
    return optionsArray;
  }, [MODERATION_CATEGORIES]);

  // Form
  const formik = useFormik({
    initialValues: {
      contributionPolicy: collectiveContributionPolicy || '',
      expensePolicy: collectiveExpensePolicy || '',
      disablePublicExpenseSubmission: collectiveDisableExpenseSubmission || false,
      policies: omitDeep(data?.account?.policies || {}, ['__typename']),
    },
    async onSubmit(values) {
      const { contributionPolicy, expensePolicy, disablePublicExpenseSubmission, policies } = values;
      await updateCollective({
        variables: {
          collective: {
            id: collective.id,
            contributionPolicy,
            expensePolicy,
            settings: { ...collective.settings, disablePublicExpenseSubmission },
          },
        },
      });
      const selectedRejectCategories = selected.map(option => option.value);
      await Promise.all([
        updateCategories({
          variables: {
            account: {
              legacyId: collective.id,
            },
            key: 'moderation',
            value: { rejectedCategories: selectedRejectCategories },
          },
        }),
        setPolicies({
          variables: {
            account: {
              legacyId: collective.id,
            },
            policies,
          },
        }),
      ]);

      addToast({
        type: TOAST_TYPE.SUCCESS,
        message: formatMessage({ defaultMessage: 'Policies updated successfully' }),
      });
    },
    validate(values) {
      const errors = {};
      const contributionPolicyText = stripHTML(values.contributionPolicy);
      const expensePolicyText = stripHTML(values.expensePolicy);

      if (contributionPolicyText.length > CONTRIBUTION_POLICY_MAX_LENGTH) {
        errors.contributionPolicy = formatMessage(messages['contributionPolicy.error'], {
          maxLength: CONTRIBUTION_POLICY_MAX_LENGTH,
        });
      }
      if (expensePolicyText.length > EXPENSE_POLICY_MAX_LENGTH) {
        errors.expensePolicy = formatMessage(messages['expensePolicy.error'], { maxLength: EXPENSE_POLICY_MAX_LENGTH });
      }
      return errors;
    },
  });

  React.useEffect(() => {
    if (collectiveContributionFilteringCategories && isEmpty(selected)) {
      const alreadyPickedCategories = collectiveContributionFilteringCategories.map(category => {
        return selectOptions.find(option => option.value === category);
      });
      setSelected(alreadyPickedCategories);
    }
  }, [loading, collectiveContributionFilteringCategories]);

  React.useEffect(() => {
    if (data) {
      formik.setFieldValue('policies', omitDeep(data?.account?.policies || {}, ['__typename']));
    }
  }, [data]);

  const numberOfAdminsOptions = [0, 2, 3, 4, 5].map(n => ({
    value: n,
    label: formatMessage(messages['requiredAdmins.numberOfAdmins'], { admins: n }),
  }));
  const minAdminsApplies = [
    { value: 'NEW_COLLECTIVES', label: <FormattedMessage defaultMessage="New Collectives Only" /> },
    { value: 'ALL_COLLECTIVES', label: <FormattedMessage defaultMessage="All Collectives" /> },
  ];

  return (
    <Flex flexDirection="column">
      {error && <MessageBoxGraphqlError error={error} />}
      <form onSubmit={formik.handleSubmit}>
        <Container>
          {!showOnlyExpensePolicy && (
            <Container mb={4}>
              <StyledInputField
                name="contributionPolicy"
                htmlFor="contributionPolicy"
                error={formik.errors.contributionPolicy}
                disabled={isSubmittingSettings}
                labelProps={{ mb: 2, pt: 2, lineHeight: '18px', fontWeight: 'bold' }}
                label={
                  <SettingsSectionTitle>{formatMessage(messages['contributionPolicy.label'])}</SettingsSectionTitle>
                }
              >
                {inputProps => (
                  <RichTextEditor
                    withBorders
                    showCount
                    maxLength={CONTRIBUTION_POLICY_MAX_LENGTH}
                    error={formik.errors.contributionPolicy}
                    version="simplified"
                    editorMinHeight="20rem"
                    editorMaxHeight={500}
                    id={inputProps.id}
                    inputName={inputProps.name}
                    onChange={formik.handleChange}
                    placeholder={formatMessage(messages['contributionPolicy.placeholder'])}
                    defaultValue={formik.values.contributionPolicy}
                    fontSize="14px"
                  />
                )}
              </StyledInputField>
              <P fontSize="14px" lineHeight="18px" color="black.600" mt={2}>
                <FormattedMessage
                  id="collective.contributionPolicy.description"
                  defaultMessage="Financial Contributors are manually reviewed by the Open Collective team to check for abuse or spam. Financial Contributors with a good reputation should not be affected by this setting."
                />
              </P>
            </Container>
          )}

          <StyledInputField
            name="expensePolicy"
            htmlFor="expensePolicy"
            error={formik.errors.expensePolicy}
            disabled={isSubmittingSettings}
            labelProps={{ mb: 2, pt: 2, lineHeight: '18px', fontWeight: 'bold' }}
            label={<SettingsSectionTitle>{formatMessage(messages['expensePolicy.label'])}</SettingsSectionTitle>}
          >
            {inputProps => (
              <RichTextEditor
                data-cy="expense-policy-input"
                withBorders
                showCount
                maxLength={EXPENSE_POLICY_MAX_LENGTH}
                error={formik.errors.expensePolicy}
                version="simplified"
                editorMinHeight="20rem"
                editorMaxHeight={500}
                id={inputProps.id}
                inputName={inputProps.name}
                onChange={formik.handleChange}
                placeholder={formatMessage(messages['expensePolicy.placeholder'])}
                defaultValue={formik.values.expensePolicy}
                fontSize="14px"
                maxHeight={600}
              />
            )}
          </StyledInputField>
          <P fontSize="14px" lineHeight="18px" color="black.600" my={2}>
            <FormattedMessage
              id="collective.expensePolicy.description"
              defaultMessage="It can be daunting to file an expense if you're not sure what's allowed. Provide a clear policy to guide expense submitters."
            />
          </P>
        </Container>

        {collective?.isHost && (
          <Container>
            <SettingsSectionTitle mt={4}>
              <FormattedMessage id="editCollective.admins.header" defaultMessage="Required Admins" />
            </SettingsSectionTitle>
            <P mb={2}>
              <FormattedMessage
                id="editCollective.admins.description"
                defaultMessage="Please specify the minimum number of admins a collective needs to have for being accepted by your fiscal host and to accept contributions."
              />
            </P>
            <Flex gap="12px 24px" mb={3} mt={2} flexDirection={['column', 'row']}>
              <StyledInputField
                disabled={isSubmittingSettings}
                labelFontSize="13px"
                labelFontWeight="700"
                label={<FormattedMessage defaultMessage="Minimum number of admins" />}
                flexGrow={1}
              >
                <StyledSelect
                  inputId="numberOfAdmins"
                  isSearchable={false}
                  options={numberOfAdminsOptions}
                  onChange={option => {
                    if (option.value === 0) {
                      formik.setFieldValue('policies', omit(formik.values.policies, ['COLLECTIVE_MINIMUM_ADMINS']));
                    } else {
                      formik.setFieldValue('policies.COLLECTIVE_MINIMUM_ADMINS', {
                        ...formik.values.policies.COLLECTIVE_MINIMUM_ADMINS,
                        numberOfAdmins: option.value,
                      });
                    }
                  }}
                  value={numberOfAdminsOptions.find(
                    option => option.value === (formik.values.policies?.COLLECTIVE_MINIMUM_ADMINS?.numberOfAdmins || 0),
                  )}
                />
              </StyledInputField>
              <StyledInputField
                disabled={isSubmittingSettings}
                labelFontSize="13px"
                labelFontWeight="700"
                label={<FormattedMessage defaultMessage="Whom does this apply to" />}
                flexGrow={1}
              >
                <StyledSelect
                  inputId="applies"
                  isSearchable={false}
                  options={minAdminsApplies}
                  onChange={option =>
                    formik.setFieldValue('policies.COLLECTIVE_MINIMUM_ADMINS', {
                      ...formik.values.policies.COLLECTIVE_MINIMUM_ADMINS,
                      applies: option.value,
                    })
                  }
                  disabled
                  value={minAdminsApplies[0]}
                />
              </StyledInputField>
            </Flex>
            <StyledCheckbox
              name="minAdminsFreeze"
              label={<FormattedMessage defaultMessage="Freeze collectives that don’t meet the minimum requirement" />}
              onChange={({ checked }) => {
                formik.setFieldValue('policies.COLLECTIVE_MINIMUM_ADMINS', {
                  ...formik.values.policies.COLLECTIVE_MINIMUM_ADMINS,
                  freeze: checked,
                });
              }}
              checked={Boolean(formik.values.policies?.COLLECTIVE_MINIMUM_ADMINS?.freeze)}
            />
            <P fontSize="14px" lineHeight="18px" color="black.600" ml="2.2rem">
              <FormattedMessage defaultMessage="Freezing the collective will prevent them from accepting and distributing contributions till they meet the requirements. This is a security measure to make sure the admins are within their rights. Read More." />
            </P>
            {formik.values.policies?.COLLECTIVE_MINIMUM_ADMINS?.applies === 'ALL_COLLECTIVES' &&
              formik.values.policies?.COLLECTIVE_MINIMUM_ADMINS?.freeze && (
                <MessageBox type="warning" mt={2} fontSize="13px">
                  <FormattedMessage defaultMessage="Some collectives hosted by you may not fulfill the minimum admin requirements. If you choose to apply the setting to all Collectives, the ones that don't comply will be frozen until they meet the minimum requirements for admins." />
                </MessageBox>
              )}
          </Container>
        )}
        <Container>
          <SettingsSectionTitle mt={4}>
            <FormattedMessage id="editCollective.expenseApprovalsPolicy.header" defaultMessage="Expense approvals" />
          </SettingsSectionTitle>
          <StyledCheckbox
            name="authorCannotApproveExpense"
            label={
              <FormattedMessage
                id="editCollective.expenseApprovalsPolicy.authorCannotApprove"
                defaultMessage="Admins cannot approve their own expenses. With this feature turned on, admins will need another admin to approve their expenses"
              />
            }
            onChange={() =>
              formik.setFieldValue(
                'policies',
                formik.values.policies?.['EXPENSE_AUTHOR_CANNOT_APPROVE']
                  ? omit(formik.values.policies, ['EXPENSE_AUTHOR_CANNOT_APPROVE'])
                  : { ...formik.values.policies, EXPENSE_AUTHOR_CANNOT_APPROVE: true },
              )
            }
            checked={Boolean(formik.values.policies?.['EXPENSE_AUTHOR_CANNOT_APPROVE'])}
            disabled={
              isSettingPolicies ||
              (numberOfAdmins < 2 && Boolean(!formik.values.policies?.['EXPENSE_AUTHOR_CANNOT_APPROVE']))
            }
          />
          {collective?.isHost && (
            <P fontSize="14px" lineHeight="18px" color="black.600" ml="2.2rem">
              <FormattedMessage
                id="editCollective.expenseApprovalsPolicy.authorCannotApprove.hostDescription"
                defaultMessage="This policy is only enforced on your fiscal host and does not affect collectives hosted by you."
              />
            </P>
          )}
          {numberOfAdmins < 2 && Boolean(!formik.values.policies?.['EXPENSE_AUTHOR_CANNOT_APPROVE']) && (
            <P fontSize="14px" lineHeight="18px" color="black.600" ml="2.2rem">
              <FormattedMessage
                id="editCollective.expenseApprovalsPolicy.authorCannotApprove.minAdminRequired"
                defaultMessage="You need to have at least two admins to enable this policy."
              />
            </P>
          )}
        </Container>
        <Container mt={3}>
          <StyledCheckbox
            name="allow-expense-submission"
            label={formatMessage(messages['expensePolicy.allowExpense'])}
            onChange={() =>
              formik.setFieldValue('disablePublicExpenseSubmission', !formik.values.disablePublicExpenseSubmission)
            }
            defaultChecked={Boolean(formik.values.disablePublicExpenseSubmission)}
          />
        </Container>
        <Container>
          <SettingsSectionTitle mt={4}>
            <FormattedMessage id="editCollective.rejectCategories.header" defaultMessage="Rejected categories" />
          </SettingsSectionTitle>
          <P mb={2}>
            <FormattedMessage
              id="editCollective.rejectCategories.description"
              defaultMessage="Specify any categories of contributor that you do not wish to accept money from, to automatically prevent these types of contributions. (You can also reject contributions individually using the button on a specific unwanted transaction)"
            />
          </P>
          <StyledSelect
            inputId="policy-select"
            isSearchable={false}
            isLoading={loading}
            placeholder={formatMessage(messages['rejectCategories.placeholder'])}
            minWidth={300}
            maxWidth={600}
            options={selectOptions}
            value={selected}
            onChange={selectedOptions => setSelected(selectedOptions)}
            isMulti
          />
        </Container>
        <Flex mt={5} mb={3} alignItems="center" justifyContent="center">
          <StyledButton
            data-cy="submit-policy-btn"
            buttonStyle="primary"
            mx={2}
            minWidth={200}
            buttonSize="medium"
            loading={isSubmittingSettings || isSubmittingCategories}
            type="submit"
            onSubmit={formik.handleSubmit}
          >
            <FormattedMessage id="save" defaultMessage="Save" />
          </StyledButton>
        </Flex>
      </form>
    </Flex>
  );
};

Policies.propTypes = {
  collective: PropTypes.shape({
    settings: PropTypes.object,
    id: PropTypes.number,
    slug: PropTypes.string,
    isHost: PropTypes.bool,
    members: PropTypes.arrayOf(
      PropTypes.shape({
        role: PropTypes.string,
      }),
    ),
  }),
  showOnlyExpensePolicy: PropTypes.bool,
};

export default Policies;
