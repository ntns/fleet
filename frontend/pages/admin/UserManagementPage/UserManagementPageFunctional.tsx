import React, { useState, useCallback, useContext } from "react";
import { useDispatch } from "react-redux";
import { useQuery } from "react-query";

import { isEqual } from "lodash";
import { push } from "react-router-redux";
import memoize from "memoize-one";

// @ts-ignore
import Fleet from "fleet";
import { IInvite } from "interfaces/invite";
import { IConfig } from "interfaces/config";
import { IUser } from "interfaces/user";
import { ITeam } from "interfaces/team";

import { AppContext } from "context/app";
import configAPI from "services/entities/config";
import teamsAPI from "services/entities/teams";
import usersAPI from "services/entities/users";
import invitesAPI from "services/entities/invites";

import paths from "router/paths";
// @ts-ignore
import { renderFlash } from "redux/nodes/notifications/actions";
// @ts-ignore
import { updateUser } from "redux/nodes/auth/actions";

import TableContainer from "components/TableContainer";
import TableDataError from "components/TableDataError";
import Modal from "components/Modal";
import { DEFAULT_CREATE_USER_ERRORS } from "utilities/constants";
import EmptyUsers from "./components/EmptyUsers";
import { generateTableHeaders, combineDataSets } from "./UsersTableConfig";
import DeleteUserForm from "./components/DeleteUserForm";
import ResetPasswordModal from "./components/ResetPasswordModal";
import ResetSessionsModal from "./components/ResetSessionsModal";
import { NewUserType } from "./components/UserForm/UserForm";
import CreateUserModal from "./components/CreateUserModal";
import EditUserModal from "./components/EditUserModal";

const baseClass = "user-management";

interface ISortBy {
  id: boolean;
  sorting: IConfig;
  currentUser: IUser;
  loadingTableData: boolean;
  invites: IInvite[];
  inviteErrors: { base: string; email: string };
  isPremiumTier: boolean;
  users: IUser[];
  userErrors: { base: string; name: string };
  teams: ITeam[];
}

interface ITeamsResponse {
  teams: ITeam[];
}

interface IUsersResponse {
  users: IUser[];
}

interface IInvitesResponse {
  invites: IInvite[];
}

// TODO: Try 1: define interface for formData and will get more helpful debugging
// TODO: Try 2: Consider re-writing this function all together....

const generateUpdateData = (currentUserData: any, formData: any) => {
  // array of updatable fields
  const updatableFields = [
    "global_role",
    "teams",
    "name",
    "email",
    "sso_enabled",
  ];

  // go over all the keys in the form data, reduce
  return Object.keys(formData).reduce((updatedAttributes, attr) => {
    // attribute can be updated and is different from the current value.
    if (
      updatableFields.includes(attr) &&
      !isEqual(formData[attr], currentUserData[attr])
    ) {
      updatedAttributes[attr] = formData[attr];
    }
    return updatedAttributes;
  }, {});
};

const UserManagementPage = (): JSX.Element => {
  const dispatch = useDispatch();

  const { config, currentUser, isPremiumTier } = useContext(AppContext);

  const {
    data: teams,
    isLoading: isLoadingTeams,
    error: loadingTeamsError,
    refetch: refetchTeams,
  } = useQuery<ITeamsResponse, Error, ITeam[]>(
    ["teams"],
    () => teamsAPI.loadAll(),
    {
      enabled: !!isPremiumTier,
      select: (data: ITeamsResponse) => data.teams,
    }
  );

  const {
    data: users,
    isLoading: isLoadingUsers,
    error: loadingUsersError,
    refetch: refetchusers,
  } = useQuery<IUsersResponse, Error, IUser[]>(
    ["users"],
    () => usersAPI.loadAll(),
    {
      select: (data: IUsersResponse) => data.users,
    }
  );

  const {
    data: invites,
    isLoading: isLoadingInvites,
    error: loadingInvitesError,
    refetch: refetchInvites,
  } = useQuery<IInvitesResponse, Error, IInvite[]>(
    ["invites"],
    () => invitesAPI.loadAll({}),
    {
      select: (data: IInvitesResponse) => data.invites,
    }
  );

  // TODO: IMPLEMENT
  // Note: If the page is refreshed, `isPremiumTier` will be false at `componentDidMount` because
  // `config` will not have been loaded at that point. Accordingly, we need this lifecycle hook so
  // that `teams` information will be available to the edit user form.
  // componentDidUpdate(prevProps) {
  //   const { dispatch, isPremiumTier } = this.props;
  //   if (prevProps.isPremiumTier !== isPremiumTier) {
  //     isPremiumTier && dispatch(teamActions.loadAll({}));
  //   }
  // }

  // █▀ ▀█▀ ▄▀█ ▀█▀ █▀▀ █▀
  // ▄█ ░█░ █▀█ ░█░ ██▄ ▄█

  const [showCreateUserModal, setShowCreateUserModal] = useState<boolean>(
    false
  );
  const [showEditUserModal, setShowEditUserModal] = useState<boolean>(false);
  const [showDeleteUserModal, setShowDeleteUserModal] = useState<boolean>(
    false
  );
  const [showResetPasswordModal, setShowResetPasswordModal] = useState<boolean>(
    false
  );
  const [showResetSessionsModal, setShowResetSessionsModal] = useState<boolean>(
    false
  );
  const [isFormSubmitting, setIsFormSubmitting] = useState<boolean>(false);
  const [userEditing, setUserEditing] = useState<any>(null);
  const [usersEditing, setUsersEditing] = useState<any>([]);
  const [createUserErrors, setCreateUserErrors] = useState<any>({
    DEFAULT_CREATE_USER_ERRORS,
  });

  // ▀█▀ █▀█ █▀▀ █▀▀ █░░ █▀▀   █▀▄▀█ █▀█ █▀▄ ▄▀█ █░░ █▀
  // ░█░ █▄█ █▄█ █▄█ █▄▄ ██▄   █░▀░█ █▄█ █▄▀ █▀█ █▄▄ ▄█

  const toggleCreateUserModal = useCallback(() => {
    setShowCreateUserModal(!showCreateUserModal);

    // clear errors on close
    if (!showCreateUserModal) {
      setCreateUserErrors({ DEFAULT_CREATE_USER_ERRORS });
    }
  }, [showCreateUserModal, setShowCreateUserModal]);

  const toggleDeleteUserModal = useCallback(
    (user?: IUser | IInvite) => {
      setShowDeleteUserModal(!showDeleteUserModal);
      // TODO: Decide which of these to use!
      user ? setUserEditing(user) : setUserEditing(undefined);
      setUserEditing(!showDeleteUserModal ? user : null);
    },
    [showDeleteUserModal, setShowDeleteUserModal, setUserEditing]
  );

  // added IInvite and undefined due to toggleeditusermodal being used later
  const toggleEditUserModal = useCallback(
    (user?: IUser | IInvite) => {
      setShowEditUserModal(!showEditUserModal);
      // TODO: Decide which of these to use!
      user ? setUserEditing(user) : setUserEditing(undefined);
      setUserEditing(!showEditUserModal ? user : null);
    },
    [showEditUserModal, setShowEditUserModal, setUserEditing]
  );

  const toggleResetPasswordUserModal = useCallback(
    (user?: IUser | IInvite) => {
      setShowResetPasswordModal(!showResetPasswordModal);
      setUserEditing(!showResetPasswordModal ? user : null);
    },
    [showResetPasswordModal, setShowResetPasswordModal, setUserEditing]
  );

  const toggleResetSessionsUserModal = useCallback(
    (user?: IUser | IInvite) => {
      setShowResetSessionsModal(!showResetSessionsModal);
      setUserEditing(!showResetSessionsModal ? user : null);
    },
    [showResetSessionsModal, setShowResetSessionsModal, setUserEditing]
  );

  // █▀▀ █░█ █▄░█ █▀▀ ▀█▀ █ █▀█ █▄░█ █▀
  // █▀░ █▄█ █░▀█ █▄▄ ░█░ █ █▄█ █░▀█ ▄█

  const combineUsersAndInvites = memoize((users, invites, currentUserId) => {
    return combineDataSets(users, invites, currentUserId);
  });

  const goToUserSettingsPage = () => {
    const { USER_SETTINGS } = paths;

    dispatch(push(USER_SETTINGS));
  };

  // NOTE: this is called once on the initial rendering. The initial render of
  // the TableContainer child component calls this handler.
  const onTableQueryChange = (queryData: any) => {
    const {
      pageIndex,
      pageSize,
      searchQuery,
      sortHeader,
      sortDirection,
    } = queryData;
    let sortBy: any = []; // TODO
    if (sortHeader !== "") {
      sortBy = [{ id: sortHeader, direction: sortDirection }];
    }

    usersAPI.loadAll({
      page: pageIndex,
      perPage: pageSize,
      globalFilter: searchQuery,
      sortBy,
    });
    invitesAPI.loadAll({
      page: pageIndex,
      perPage: pageSize,
      globalFilter: searchQuery,
      sortBy,
    });
  };

  const onActionSelect = (value: string, user: IUser | IInvite) => {
    switch (value) {
      case "edit":
        toggleEditUserModal(user);
        break;
      case "delete":
        toggleDeleteUserModal(user);
        break;
      case "passwordReset":
        toggleResetPasswordUserModal(user);
        break;
      case "resetSessions":
        toggleResetSessionsUserModal(user);
        break;
      case "editMyAccount":
        goToUserSettingsPage();
        break;
      default:
        return null;
    }
    return null;
  };

  const getUser = (type: string, id: number) => {
    let userData;
    if (type === "user") {
      userData = users?.find((user) => user.id === id);
    } else {
      userData = invites?.find((invite) => invite.id === id);
    }
    return userData;
  };

  const onCreateUserSubmit = (formData: any) => {
    setIsFormSubmitting(true);

    if (formData.newUserType === NewUserType.AdminInvited) {
      // Do some data formatting adding `invited_by` for the request to be correct and deleteing uncessary fields
      const requestData = {
        ...formData,
        invited_by: formData.currentUserId,
      };
      delete requestData.currentUserId; // this field is not needed for the request
      delete requestData.newUserType; // this field is not needed for the request
      delete requestData.password; // this field is not needed for the request
      invitesAPI
        .create(requestData)
        .then(() => {
          dispatch(
            renderFlash(
              "success",
              `An invitation email was sent from ${config?.sender_address} to ${formData.email}.`
            )
          );
          toggleCreateUserModal();
        })
        .catch((userErrors: any) => {
          if (userErrors.base?.includes("Duplicate")) {
            dispatch(
              renderFlash(
                "error",
                "A user with this email address already exists."
              )
            );
          } else {
            dispatch(
              renderFlash("error", "Could not create user. Please try again.")
            );
          }
        })
        .finally(() => {
          setIsFormSubmitting(false);
        });
    } else {
      // Do some data formatting deleteing uncessary fields
      const requestData = {
        ...formData,
      };
      delete requestData.currentUserId; // this field is not needed for the request
      delete requestData.newUserType; // this field is not needed for the request
      usersAPI
        .createUserWithoutInvitation(requestData)
        .then(() => {
          dispatch(
            renderFlash("success", `Successfully created ${requestData.name}.`)
          );
          toggleCreateUserModal();
        })
        .catch((userErrors: any) => {
          if (userErrors.base?.includes("Duplicate")) {
            dispatch(
              renderFlash(
                "error",
                "A user with this email address already exists."
              )
            );
          } else {
            dispatch(
              renderFlash("error", "Could not create user. Please try again.")
            );
          }
        })
        .finally(() => {
          setIsFormSubmitting(false);
        });
    }
  };

  const onEditUser = (formData: any) => {
    const userData = getUser(userEditing.type, userEditing.id);

    const updatedAttrs = generateUpdateData(userData, formData);
    if (userEditing.type === "invite") {
      // Note: The edit invite action in this if block is occuring outside of Redux (unlike the
      // other cases below this block). Therefore, we must dispatch the loadAll action to ensure the
      // Redux store is updated.
      return (
        userData &&
        invitesAPI
          .update(userData, formData)
          .then(() => {
            dispatch(
              renderFlash("success", `Successfully edited ${userEditing?.name}`)
            );
            toggleEditUserModal();
          })
          .then(() => invitesAPI.loadAll({}))
          .catch(() => {
            dispatch(
              renderFlash(
                "error",
                `Could not edit ${userEditing?.name}. Please try again.`
              )
            );
            toggleEditUserModal();
          })
      );
    }

    if (currentUser?.id === userEditing.id) {
      return dispatch(updateUser(userData, updatedAttrs))
        .then(() => {
          dispatch(
            renderFlash("success", `Successfully edited ${userEditing?.name}`)
          );
          toggleEditUserModal();
        })
        .catch(() => {
          dispatch(
            renderFlash(
              "error",
              `Could not edit ${userEditing?.name}. Please try again.`
            )
          );
          toggleEditUserModal();
        });
    }

    let userUpdatedFlashMessage = `Successfully edited ${formData.name}`;

    if (userData?.email !== formData.email) {
      userUpdatedFlashMessage += `: A confirmation email was sent from ${config?.sender_address} to ${formData.email}`;
    }

    return usersAPI
      .update(userData, formData)
      .then(() => {
        dispatch(renderFlash("success", userUpdatedFlashMessage));
        toggleEditUserModal();
      })
      .catch(() => {
        dispatch(
          renderFlash(
            "error",
            `Could not edit ${userEditing?.name}. Please try again.`
          )
        );
        toggleEditUserModal();
      });
  };

  const onDeleteUser = () => {
    if (userEditing.type === "invite") {
      invitesAPI
        .destroy(userEditing)
        .then(() => {
          dispatch(
            renderFlash("success", `Successfully deleted ${userEditing?.name}.`)
          );
        })
        .catch(() => {
          dispatch(
            renderFlash(
              "error",
              `Could not delete ${userEditing?.name}. Please try again.`
            )
          );
        });
      toggleDeleteUserModal();
    } else {
      usersAPI
        .destroy(userEditing)
        .then(() => {
          dispatch(
            renderFlash("success", `Successfully deleted ${userEditing?.name}.`)
          );
        })
        .catch(() => {
          dispatch(
            renderFlash(
              "error",
              `Could not delete ${userEditing?.name}. Please try again.`
            )
          );
        });
      toggleDeleteUserModal();
    }
  };

  const onResetSessions = () => {
    const isResettingCurrentUser = currentUser?.id === userEditing.id;

    usersAPI
      .deleteSessions(userEditing)
      .then(() => {
        if (!isResettingCurrentUser) {
          dispatch(renderFlash("success", "Sessions reset"));
        }
      })
      .catch(() => {
        dispatch(
          renderFlash(
            "error",
            "Could not reset sessions for the selected user. Please try again."
          )
        );
      });
    toggleResetSessionsUserModal();
  };

  const resetPassword = (user: IUser) => {
    return usersAPI
      .requirePasswordReset(user.id, { require: true })
      .then(() => {
        dispatch(
          renderFlash(
            "success",
            "User required to reset password",
            usersAPI.requirePasswordReset(user.id, { require: false }) // this is an undo action.
          )
        );
        toggleResetPasswordUserModal();
      });
  };

  const renderEditUserModal = () => {
    if (!showEditUserModal) return null;

    const userData = getUser(userEditing.type, userEditing.id);

    return (
      <Modal
        title="Edit user"
        onExit={toggleEditUserModal}
        className={`${baseClass}__edit-user-modal`}
      >
        <>
          <EditUserModal
            defaultEmail={userData?.email}
            defaultName={userData?.name}
            defaultGlobalRole={userData?.global_role}
            defaultTeams={userData?.teams}
            onCancel={toggleEditUserModal}
            onSubmit={onEditUser}
            availableTeams={teams || []}
            isPremiumTier={isPremiumTier || false}
            smtpConfigured={config?.configured || false}
            canUseSso={config?.enable_sso || false}
            isSsoEnabled={userData?.sso_enabled}
            isModifiedByGlobalAdmin
          />
        </>
      </Modal>
    );
  };

  const renderCreateUserModal = () => {
    if (!showCreateUserModal) return null;

    return (
      <CreateUserModal
        createUserErrors={createUserErrors}
        onCancel={toggleCreateUserModal}
        onSubmit={onCreateUserSubmit}
        availableTeams={teams}
        defaultGlobalRole={"observer"}
        defaultTeams={[]}
        isPremiumTier={isPremiumTier || false}
        smtpConfigured={config?.configured || false}
        canUseSso={config?.enable_sso || false}
        isFormSubmitting={isFormSubmitting}
        isModifiedByGlobalAdmin
      />
    );
  };

  const renderDeleteUserModal = () => {
    if (!showDeleteUserModal) return null;

    return (
      <Modal
        title={"Delete user"}
        onExit={toggleDeleteUserModal}
        className={`${baseClass}__delete-user-modal`}
      >
        <DeleteUserForm
          name={userEditing.name}
          onDelete={onDeleteUser}
          onCancel={toggleDeleteUserModal}
        />
      </Modal>
    );
  };

  const renderResetPasswordModal = () => {
    if (!showResetPasswordModal) return null;

    return (
      <ResetPasswordModal
        user={userEditing}
        modalBaseClass={baseClass}
        onResetConfirm={resetPassword}
        onResetCancel={toggleResetPasswordUserModal}
      />
    );
  };

  const renderResetSessionsModal = () => {
    if (!showResetSessionsModal) return null;

    return (
      <ResetSessionsModal
        user={userEditing}
        modalBaseClass={baseClass}
        onResetConfirm={onResetSessions}
        onResetCancel={toggleResetSessionsUserModal}
      />
    );
  };

  const tableHeaders = generateTableHeaders(onActionSelect, isPremiumTier);

  const loadingTableData = isLoadingUsers || isLoadingInvites;

  let tableData: any = [];
  if (!loadingTableData) {
    tableData = combineUsersAndInvites(users, invites, currentUser?.id);
  }

  return (
    <div className={`${baseClass} body-wrap`}>
      <p className={`${baseClass}__page-description`}>
        Create new users, customize user permissions, and remove users from
        Fleet.
      </p>
      {/* TODO: find a way to move these controls into the table component */}
      {users?.length === 0 && Object.keys(createUserErrors).length > 0 ? (
        <TableDataError />
      ) : (
        <TableContainer
          columns={tableHeaders}
          data={tableData}
          isLoading={loadingTableData}
          defaultSortHeader={"name"}
          defaultSortDirection={"asc"}
          inputPlaceHolder={"Search"}
          actionButtonText={"Create user"}
          onActionButtonClick={toggleCreateUserModal}
          onQueryChange={onTableQueryChange}
          resultsTitle={"users"}
          emptyComponent={EmptyUsers}
          searchable
          showMarkAllPages={false}
          isAllPagesSelected={false}
        />
      )}
      {renderCreateUserModal()}
      {renderEditUserModal()}
      {renderDeleteUserModal()}
      {renderResetSessionsModal()}
      {renderResetPasswordModal()}
    </div>
  );
};

export default UserManagementPage;
